import { EventEmitter } from 'events';
import net from 'net';
import dgram from 'dgram';
import os from 'os';
import Bonjour, { Service } from 'bonjour-service';
import { User, PeerMessage, MessageType } from '../../shared/types';

const SERVICE_TYPE = 'zenstate';
const BEACON_PORT = 5354;
const HEARTBEAT_INTERVAL = 5000;
const BEACON_INTERVAL = 10000;
const SIGNAL_POLL_INTERVAL = 15000;
const SIGNAL_SERVER_URL = 'https://zenstate-two.vercel.app';
const NETWORK_CHECK_INTERVAL = 10000; // Check for IP changes every 10s
const PEER_STALE_THRESHOLD = 60000; // Remove peers with no activity for 60s

/**
 * NetworkingService — Port of BonjourService.swift
 *
 * Wire-compatible with the Swift app:
 * - Same service type: _zenstate._tcp
 * - Same wire format: 4-byte big-endian length prefix + JSON
 * - Same PeerMessage structure
 * - Same UDP beacon: ZENSTATE|<uuid>|<port> on port 5354
 */
export class NetworkingService extends EventEmitter {
  private currentUser: User;
  private tcpServer: net.Server | null = null;
  private tcpPort: number = 0;
  private bonjour: InstanceType<typeof Bonjour> | null = null;
  private bonjourBrowser: ReturnType<InstanceType<typeof Bonjour>['find']> | null = null;
  private bonjourService: Service | null = null;

  private connections = new Map<string, net.Socket>(); // userId → socket
  private peers = new Map<string, User>(); // userId → User

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private beaconTimer: NodeJS.Timeout | null = null;
  private beaconSocket: dgram.Socket | null = null;
  private beaconListener: dgram.Socket | null = null;

  private pendingRetries = new Map<string, number>(); // endpoint → retry count
  private pendingConnections = new Set<string>(); // endpoints currently connecting
  private signalTimer: NodeJS.Timeout | null = null;
  private networkCheckTimer: NodeJS.Timeout | null = null;
  private lastKnownAddresses: string[] = []; // Track IP changes
  private peerLastActivity = new Map<string, number>(); // userId → timestamp of last received message
  private isRestarting = false;

  constructor(user: User) {
    super();
    this.currentUser = user;
  }

  /**
   * Safely tear down a socket and remove its associated peer.
   * Idempotent — safe to call multiple times for the same socket.
   */
  private cleanupSocket(socket: net.Socket, reason?: string) {
    if (reason) {
      console.log(`Socket cleanup (${reason})`);
    }

    for (const [userId, conn] of this.connections) {
      if (conn === socket) {
        this.connections.delete(userId);
        this.peers.delete(userId);
        this.peerLastActivity.delete(userId);
        this.emit('peerLost', userId);
        break;
      }
    }

    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  // ── Public API ───────────────────────────────────────────────

  start() {
    this.startTCPServer();
  }

  stop() {
    this.heartbeatTimer && clearInterval(this.heartbeatTimer);
    this.beaconTimer && clearInterval(this.beaconTimer);
    this.signalTimer && clearInterval(this.signalTimer);
    this.networkCheckTimer && clearInterval(this.networkCheckTimer);

    this.bonjourBrowser?.stop();
    this.bonjourService && this.bonjour?.unpublishAll();
    this.bonjour?.destroy();

    this.beaconSocket?.close();
    this.beaconListener?.close();

    for (const socket of this.connections.values()) {
      socket.destroy();
    }
    this.connections.clear();
    this.peers.clear();
    this.peerLastActivity.clear();
    this.pendingConnections.clear();

    this.tcpServer?.close();
  }

  /**
   * Gracefully restart all networking after a network change (WiFi switch, resume from sleep).
   * Tears down stale connections and rebinds to the new network interface.
   */
  async restart() {
    if (this.isRestarting) return;
    this.isRestarting = true;
    console.log('NetworkingService: restarting due to network change...');

    // Stop timers and discovery
    this.heartbeatTimer && clearInterval(this.heartbeatTimer);
    this.beaconTimer && clearInterval(this.beaconTimer);
    this.signalTimer && clearInterval(this.signalTimer);
    // Keep networkCheckTimer running — it's what triggers restart

    // Teardown Bonjour
    try {
      this.bonjourBrowser?.stop();
      this.bonjourService && this.bonjour?.unpublishAll();
      this.bonjour?.destroy();
    } catch (err) {
      console.error('Bonjour teardown error:', err);
    }
    this.bonjour = null;
    this.bonjourBrowser = null;
    this.bonjourService = null;

    // Teardown UDP sockets
    try { this.beaconSocket?.close(); } catch (_) { /* ignore */ }
    try { this.beaconListener?.close(); } catch (_) { /* ignore */ }
    this.beaconSocket = null;
    this.beaconListener = null;

    // Destroy all peer sockets — they are bound to old network
    for (const [userId, socket] of this.connections) {
      socket.destroy();
      this.emit('peerLost', userId);
    }
    this.connections.clear();
    this.peers.clear();
    this.peerLastActivity.clear();
    this.pendingConnections.clear();
    this.pendingRetries.clear();

    // Close old TCP server
    const oldServer = this.tcpServer;
    this.tcpServer = null;
    this.tcpPort = 0;

    await new Promise<void>((resolve) => {
      if (oldServer) {
        oldServer.close(() => resolve());
      } else {
        resolve();
      }
    });

    // Re-initialize everything on new network
    this.lastKnownAddresses = this.getLocalAddresses();
    this.startTCPServer();
    this.isRestarting = false;
    console.log('NetworkingService: restart complete, new IPs:', this.lastKnownAddresses);
  }

  /**
   * Called on system resume from sleep to handle potential network changes.
   */
  handleSystemResume() {
    console.log('NetworkingService: system resumed from sleep, scheduling restart...');
    // Delay slightly to let OS re-establish WiFi
    setTimeout(() => this.restart(), 3000);
  }

  updateUser(user: User) {
    this.currentUser = user;
    this.broadcastStatusUpdate();
  }

  getPeers(): User[] {
    return Array.from(this.peers.values());
  }

  /**
   * Manually connect to a peer by IP address and port.
   * Used as a fallback when auto-discovery fails.
   */
  connectToIP(host: string, port: number) {
    console.log(`Manual connection requested to ${host}:${port}`);
    this.connectToEndpoint(host, port);
  }

  /**
   * Returns the TCP port this instance is listening on.
   */
  getTCPPort(): number {
    return this.tcpPort;
  }

  /**
   * Returns all non-internal IPv4 addresses on this machine.
   */
  getLocalAddresses(): string[] {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
    return addresses;
  }

  sendMeetingRequest(userId: string, message?: string) {
    this.sendPeerMessage(userId, {
      type: MessageType.MeetingRequest,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      timestamp: new Date().toISOString(),
      requestMessage: message,
    });
  }

  cancelMeetingRequest(userId: string) {
    this.sendPeerMessage(userId, {
      type: MessageType.MeetingRequestCancel,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      timestamp: new Date().toISOString(),
    });
  }

  respondToMeetingRequest(userId: string, accepted: boolean, message?: string) {
    this.sendPeerMessage(userId, {
      type: accepted ? MessageType.MeetingRequestAccepted : MessageType.MeetingRequestDeclined,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      timestamp: new Date().toISOString(),
      requestMessage: message,
    });
  }

  sendEmergencyRequest(userId: string, message?: string) {
    this.sendPeerMessage(userId, {
      type: MessageType.EmergencyMeetingRequest,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      timestamp: new Date().toISOString(),
      requestMessage: message,
    });
  }

  sendAdminNotification(recipientIds: string[] | 'all', message: string) {
    const msg: PeerMessage = {
      type: MessageType.AdminNotification,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      timestamp: new Date().toISOString(),
      requestMessage: message,
    };

    if (recipientIds === 'all') {
      for (const socket of this.connections.values()) {
        this.sendWireMessage(socket, msg);
      }
    } else {
      for (const userId of recipientIds) {
        this.sendPeerMessage(userId, msg);
      }
    }
  }

  grantEmergencyAccess(userId: string, granted: boolean) {
    // Update local peer record so admin UI reflects the change immediately
    const peer = this.peers.get(userId);
    if (peer) {
      peer.canSendEmergency = granted;
      this.peers.set(userId, peer);
      this.emit('peerUpdated', peer);
    }

    this.sendPeerMessage(userId, {
      type: MessageType.EmergencyAccessGrant,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      timestamp: new Date().toISOString(),
      requestMessage: granted ? 'granted' : 'revoked',
    });
  }

  // ── TCP Server (replaces NWListener) ─────────────────────────

  private startTCPServer() {
    this.tcpServer = net.createServer((socket) => {
      this.handleIncomingConnection(socket);
    });

    this.tcpServer.on('error', (err) => {
      console.error('TCP server error:', err);
    });

    // Listen on random port (like NWListener dynamic port)
    this.tcpServer.listen(0, () => {
      const addr = this.tcpServer!.address() as net.AddressInfo;
      this.tcpPort = addr.port;
      console.log(`TCP server listening on port ${this.tcpPort}`);

      // Capture initial IPs for change detection
      this.lastKnownAddresses = this.getLocalAddresses();

      // Now start Bonjour advertising + browsing + beacons + signaling
      this.startBonjour();
      this.startHeartbeat();
      this.startBeaconListener();
      this.startBeaconBroadcast();
      this.startSignaling();
      this.startNetworkChangeDetection();
    });
  }

  private handleIncomingConnection(socket: net.Socket) {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;

    socket.on('error', (err) => {
      console.error(`Socket error [incoming:${remoteAddr}]: ${err.message}`);
      this.cleanupSocket(socket, `error: ${err.message}`);
    });

    socket.on('close', () => {
      this.cleanupSocket(socket, `close:${remoteAddr}`);
    });

    // Send our userInfo (symmetric handshake — matches Swift fix)
    this.sendUserInfo(socket);
    this.setupSocketReceiver(socket);
  }

  // ── Bonjour (replaces NWBrowser) ─────────────────────────────

  private startBonjour() {
    try {
      this.bonjour = new Bonjour();

      // Advertise our service (replaces NWListener.Service)
      const serviceName = `${this.currentUser.id.substring(0, 8)}_${this.currentUser.username}`;
      this.bonjourService = this.bonjour.publish({
        name: serviceName,
        type: SERVICE_TYPE,
        port: this.tcpPort,
        protocol: 'tcp',
      }) as unknown as Service;

      // Browse for peers (replaces NWBrowser)
      this.bonjourBrowser = this.bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' });

      this.bonjourBrowser.on('up', (service: Service) => {
        // Filter out self
        const selfPrefix = this.currentUser.id.substring(0, 8);
        if (service.name?.startsWith(selfPrefix)) return;

        console.log(`Bonjour: discovered service ${service.name} at ${service.host}:${service.port}`);
        this.connectToEndpoint(service.host!, service.port);
      });

      this.bonjourBrowser.on('down', (service: Service) => {
        // Find which peer this was and remove them
        for (const [userId, peer] of this.peers) {
          if (service.name?.startsWith(peer.id.substring(0, 8))) {
            const socket = this.connections.get(userId);
            if (socket) this.cleanupSocket(socket, 'bonjour down');
            break;
          }
        }
      });
    } catch (err) {
      console.error('Bonjour initialization failed (mDNS may be unavailable):', err);
      // Continue with beacon-only discovery
    }
  }

  // ── Connect to Endpoint (replaces connectToEndpoint) ─────────

  /**
   * Normalize IPv6-mapped addresses: strip ::ffff: prefix
   */
  private normalizeHost(host: string): string {
    return host.replace(/^::ffff:/, '');
  }

  private connectToEndpoint(host: string, port: number) {
    const normalizedHost = this.normalizeHost(host);
    const endpointKey = `${normalizedHost}:${port}`;

    // Prevent duplicate connection attempts
    if (this.pendingConnections.has(endpointKey)) return;

    // Check if we already have a live connection to this endpoint
    for (const socket of this.connections.values()) {
      if (!socket.destroyed) {
        const remoteAddr = this.normalizeHost(socket.remoteAddress || '');
        if (remoteAddr === normalizedHost && socket.remotePort === port) return;
      }
    }

    this.pendingConnections.add(endpointKey);
    const socket = new net.Socket();

    socket.connect(port, host, () => {
      console.log(`Connected to ${endpointKey}`);
      this.pendingConnections.delete(endpointKey);
      this.pendingRetries.delete(endpointKey);
      this.sendUserInfo(socket);
      this.setupSocketReceiver(socket);
    });

    socket.on('error', (err) => {
      console.log(`Socket error for ${endpointKey}: ${err.message}`);
      this.pendingConnections.delete(endpointKey);

      // Check if this socket has a peer association (post-connection)
      const hasPeer = Array.from(this.connections.values()).includes(socket);

      if (!hasPeer) {
        // Connection establishment failed — retry logic
        socket.destroy();
        const retryCount = (this.pendingRetries.get(endpointKey) ?? 0) + 1;
        this.pendingRetries.set(endpointKey, retryCount);
        if (retryCount < 3) {
          setTimeout(() => this.connectToEndpoint(host, port), 2000);
        } else {
          this.pendingRetries.delete(endpointKey);
        }
      } else {
        // Post-connection error — clean up the peer
        this.cleanupSocket(socket, `post-connect error: ${err.message}`);
      }
    });

    socket.on('close', () => {
      this.pendingConnections.delete(endpointKey);
      this.cleanupSocket(socket, `close:${endpointKey}`);
    });
  }

  // ── Wire Protocol ────────────────────────────────────────────
  // Identical to Swift: 4-byte big-endian UInt32 length + JSON payload

  private sendUserInfo(socket: net.Socket) {
    const userPayload = Buffer.from(JSON.stringify(this.currentUser), 'utf-8');

    const message: PeerMessage = {
      type: MessageType.UserInfo,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      payload: userPayload.toString('base64'),
      timestamp: new Date().toISOString(),
    };

    this.sendWireMessage(socket, message);
  }

  private sendWireMessage(socket: net.Socket, message: PeerMessage) {
    if (socket.destroyed || !socket.writable) {
      return;
    }

    try {
      const jsonData = Buffer.from(JSON.stringify(message), 'utf-8');
      const lengthBuf = Buffer.alloc(4);
      lengthBuf.writeUInt32BE(jsonData.length, 0);

      socket.write(Buffer.concat([lengthBuf, jsonData]), (err) => {
        if (err) {
          console.error(`Async write error: ${err.message}`);
          this.cleanupSocket(socket, `write error: ${err.message}`);
        }
      });
    } catch (err) {
      console.error('Sync send error:', err);
      this.cleanupSocket(socket, 'sync write exception');
    }
  }

  private sendPeerMessage(userId: string, message: PeerMessage) {
    const socket = this.connections.get(userId);
    if (!socket) {
      console.log(`No connection to user ${userId}`);
      return;
    }
    this.sendWireMessage(socket, message);
  }

  // ── Receive Messages ─────────────────────────────────────────

  private setupSocketReceiver(socket: net.Socket) {
    let buffer = Buffer.alloc(0);

    // 30s timeout — if no data for 6 heartbeats, peer is gone
    socket.setTimeout(30000);
    socket.on('timeout', () => {
      console.log('Socket timed out — closing connection');
      this.cleanupSocket(socket, 'timeout');
    });

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      // Process all complete messages in buffer
      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32BE(0);

        if (buffer.length < 4 + messageLength) break; // Incomplete message

        const messageData = buffer.subarray(4, 4 + messageLength);
        buffer = buffer.subarray(4 + messageLength);

        try {
          const message: PeerMessage = JSON.parse(messageData.toString('utf-8'));
          this.handleReceivedMessage(message, socket);
        } catch (err) {
          console.error('Failed to decode message:', err);
        }
      }
    });
  }

  private handleReceivedMessage(message: PeerMessage, socket: net.Socket) {
    // Track activity for any message from a known sender
    if (message.senderId) {
      this.peerLastActivity.set(message.senderId, Date.now());
    }

    switch (message.type) {
      case MessageType.UserInfo: {
        if (message.payload) {
          try {
            const raw = JSON.parse(Buffer.from(message.payload, 'base64').toString('utf-8'));
            const user = this.validateUserProfile(raw);
            if (!user) {
              console.warn('Rejected invalid user profile from:', message.senderId);
              break;
            }

            // Clean up stale connection if different socket exists
            const existingSocket = this.connections.get(user.id);
            const isNewPeer = !existingSocket;
            if (existingSocket && existingSocket !== socket) {
              existingSocket.destroy();
            }

            user.lastSeen = new Date().toISOString();
            this.connections.set(user.id, socket);
            this.peers.set(user.id, user);
            this.peerLastActivity.set(user.id, Date.now());

            if (isNewPeer) {
              this.sendUserInfo(socket); // Bidirectional discovery
              this.emit('peerDiscovered', user);
            } else {
              this.emit('peerUpdated', user);
            }
          } catch (err) {
            console.error('Failed to decode user info:', err);
          }
        }
        break;
      }

      case MessageType.StatusUpdate:
      case MessageType.Heartbeat: {
        if (message.payload) {
          try {
            const raw = JSON.parse(Buffer.from(message.payload, 'base64').toString('utf-8'));
            const user = this.validateUserProfile(raw);
            if (!user) break;

            user.lastSeen = new Date().toISOString();
            this.peers.set(user.id, user);
            this.peerLastActivity.set(user.id, Date.now());
            this.emit('peerUpdated', user);
          } catch (err) {
            console.error('Failed to decode status/heartbeat:', err);
          }
        }
        break;
      }

      case MessageType.MeetingRequest:
        this.emit('meetingRequest', {
          from: message.senderName,
          senderId: message.senderId,
          message: message.requestMessage,
        });
        break;

      case MessageType.MeetingRequestCancel:
        this.emit('meetingRequestCancel', message.senderId);
        break;

      case MessageType.MeetingRequestAccepted:
        this.emit('meetingResponse', { accepted: true, from: message.senderName, message: message.requestMessage });
        break;

      case MessageType.MeetingRequestDeclined:
        this.emit('meetingResponse', { accepted: false, from: message.senderName, message: message.requestMessage });
        break;

      case MessageType.EmergencyMeetingRequest:
        this.emit('emergencyRequest', {
          from: message.senderName,
          senderId: message.senderId,
          message: message.requestMessage,
        });
        break;

      case MessageType.EmergencyAccessGrant: {
        const granted = message.requestMessage === 'granted';
        this.currentUser.canSendEmergency = granted;
        this.emit('emergencyAccess', granted);
        break;
      }

      case MessageType.AdminNotification:
        this.emit('adminNotification', {
          from: message.senderName,
          senderId: message.senderId,
          message: message.requestMessage,
        });
        break;
    }
  }

  // ── Broadcast Status ─────────────────────────────────────────

  private broadcastStatusUpdate() {
    const userPayload = Buffer.from(JSON.stringify(this.currentUser), 'utf-8');

    const message: PeerMessage = {
      type: MessageType.StatusUpdate,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      payload: userPayload.toString('base64'),
      timestamp: new Date().toISOString(),
    };

    for (const socket of this.connections.values()) {
      this.sendWireMessage(socket, message);
    }
  }

  // ── Heartbeat ────────────────────────────────────────────────

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.currentUser.lastSeen = new Date().toISOString();
      const now = Date.now();

      // Clean up dead connections and stale peers
      for (const [userId, socket] of this.connections) {
        if (socket.destroyed) {
          this.cleanupSocket(socket, 'heartbeat cleanup');
          continue;
        }
        // Check for stale peers — no activity for PEER_STALE_THRESHOLD
        const lastActivity = this.peerLastActivity.get(userId);
        if (lastActivity && (now - lastActivity) > PEER_STALE_THRESHOLD) {
          console.log(`Peer ${userId} stale (no activity for ${Math.round((now - lastActivity) / 1000)}s)`);
          this.cleanupSocket(socket, 'stale peer timeout');
        }
      }

      const userPayload = Buffer.from(JSON.stringify(this.currentUser), 'utf-8');
      const message: PeerMessage = {
        type: MessageType.Heartbeat,
        senderId: this.currentUser.id,
        senderName: this.currentUser.name,
        payload: userPayload.toString('base64'),
        timestamp: new Date().toISOString(),
      };

      for (const socket of this.connections.values()) {
        this.sendWireMessage(socket, message);
      }
    }, HEARTBEAT_INTERVAL);
  }

  // ── UDP Beacon (cross-extender discovery) ────────────────────

  private startBeaconListener() {
    this.beaconListener = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.beaconListener.on('message', (msg, rinfo) => {
      const text = msg.toString('utf-8');
      if (!text.startsWith('ZENSTATE|')) return;

      const parts = text.split('|');
      if (parts.length !== 3) return;

      const peerUUID = parts[1];
      const tcpPort = parseInt(parts[2], 10);
      if (!peerUUID || isNaN(tcpPort)) return;
      if (peerUUID === this.currentUser.id) return; // Ignore self

      // Skip if already connected
      const existing = this.connections.get(peerUUID);
      if (existing && !existing.destroyed) return;

      console.log(`Beacon: discovered peer ${peerUUID} at ${rinfo.address}:${tcpPort}`);
      this.connectToEndpoint(rinfo.address, tcpPort);
    });

    this.beaconListener.bind(BEACON_PORT, () => {
      console.log(`Beacon listener on port ${BEACON_PORT}`);
    });

    this.beaconListener.on('error', (err) => {
      console.error('Beacon listener error:', err);
    });
  }

  private startBeaconBroadcast() {
    this.beaconSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.beaconSocket.bind(() => {
      this.beaconSocket!.setBroadcast(true);
      this.sendBeacon(); // Send immediately
    });

    this.beaconTimer = setInterval(() => this.sendBeacon(), BEACON_INTERVAL);
  }

  private sendBeacon() {
    if (!this.beaconSocket || !this.tcpPort) return;

    const beacon = `ZENSTATE|${this.currentUser.id}|${this.tcpPort}`;
    const data = Buffer.from(beacon, 'utf-8');

    this.beaconSocket.send(data, BEACON_PORT, '255.255.255.255', (err) => {
      if (err) console.error('Beacon send error:', err);
    });
  }

  // ── Signaling Server (cloud-assisted discovery) ────────────

  private startSignaling() {
    // Send initial heartbeat immediately, then poll on interval
    this.signalHeartbeat();
    this.signalTimer = setInterval(() => this.signalHeartbeat(), SIGNAL_POLL_INTERVAL);
  }

  private async signalHeartbeat() {
    if (!this.tcpPort) return;

    const addresses = this.getLocalAddresses();
    const ip = addresses[0]; // primary LAN IP
    if (!ip) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      // Register presence
      await fetch(`${SIGNAL_SERVER_URL}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.currentUser.id,
          name: this.currentUser.name,
          username: this.currentUser.username,
          ip,
          port: this.tcpPort,
        }),
        signal: controller.signal,
      });

      // Fetch peers
      const res = await fetch(
        `${SIGNAL_SERVER_URL}/api/peers?exclude=${encodeURIComponent(this.currentUser.id)}`,
        { signal: controller.signal }
      );
      if (!res.ok) return;

      const data = await res.json() as { peers: Array<{ userId: string; ip: string; port: number }> };

      for (const peer of data.peers) {
        // Skip if already connected
        const existing = this.connections.get(peer.userId);
        if (existing && !existing.destroyed) continue;

        console.log(`Signal: discovered peer ${peer.userId} at ${peer.ip}:${peer.port}`);
        this.connectToEndpoint(peer.ip, peer.port);
      }
    } catch (err) {
      // Silently ignore — signaling is a supplementary discovery method
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Network Change Detection ────────────────────────────────

  /**
   * Polls for IP address changes. When the active network interface changes
   * (e.g., WiFi switch), triggers a full networking restart.
   */
  private startNetworkChangeDetection() {
    this.networkCheckTimer = setInterval(() => {
      const currentAddresses = this.getLocalAddresses();
      const addressesChanged = !this.arraysEqual(currentAddresses, this.lastKnownAddresses);

      if (addressesChanged) {
        const hadAddresses = this.lastKnownAddresses.length > 0;
        const hasAddresses = currentAddresses.length > 0;

        if (hadAddresses && hasAddresses) {
          // Network interface changed (WiFi switch)
          console.log(
            `Network change detected: ${this.lastKnownAddresses.join(',')} → ${currentAddresses.join(',')}`
          );
          this.restart();
        } else if (!hadAddresses && hasAddresses) {
          // Network came back online
          console.log('Network came online:', currentAddresses.join(','));
          this.restart();
        } else if (hadAddresses && !hasAddresses) {
          // Network went offline — mark all peers as lost
          console.log('Network went offline');
          this.lastKnownAddresses = currentAddresses;
          for (const [userId, socket] of this.connections) {
            socket.destroy();
            this.emit('peerLost', userId);
          }
          this.connections.clear();
          this.peers.clear();
          this.peerLastActivity.clear();
        }
      }
    }, NETWORK_CHECK_INTERVAL);
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, idx) => val === sortedB[idx]);
  }

  // ── Profile Validation ──────────────────────────────────────

  /**
   * Validates that an incoming user profile has all required fields.
   * Returns the user if valid, null otherwise.
   */
  private validateUserProfile(data: unknown): User | null {
    if (!data || typeof data !== 'object') return null;
    const u = data as Record<string, unknown>;
    if (typeof u.id !== 'string' || !u.id) return null;
    if (typeof u.name !== 'string' || !u.name) return null;
    if (typeof u.username !== 'string' || !u.username) return null;
    if (typeof u.status !== 'string') return null;
    // Reject oversized avatar data (> 500KB base64 ≈ ~375KB image)
    if (typeof u.avatarImageData === 'string' && u.avatarImageData.length > 500000) {
      u.avatarImageData = undefined;
    }
    return data as User;
  }
}
