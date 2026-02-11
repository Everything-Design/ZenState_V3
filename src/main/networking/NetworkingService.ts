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
    this.pendingConnections.clear();

    this.tcpServer?.close();
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

      // Now start Bonjour advertising + browsing + beacons
      this.startBonjour();
      this.startHeartbeat();
      this.startBeaconListener();
      this.startBeaconBroadcast();
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
    switch (message.type) {
      case MessageType.UserInfo: {
        if (message.payload) {
          try {
            const user: User = JSON.parse(Buffer.from(message.payload, 'base64').toString('utf-8'));

            // Clean up stale connection if different socket exists
            const existingSocket = this.connections.get(user.id);
            const isNewPeer = !existingSocket;
            if (existingSocket && existingSocket !== socket) {
              existingSocket.destroy();
            }

            this.connections.set(user.id, socket);
            this.peers.set(user.id, user);

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
            const user: User = JSON.parse(Buffer.from(message.payload, 'base64').toString('utf-8'));
            this.peers.set(user.id, user);
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

      // Clean up dead connections
      for (const [userId, socket] of this.connections) {
        if (socket.destroyed) {
          this.cleanupSocket(socket, 'heartbeat cleanup');
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
}
