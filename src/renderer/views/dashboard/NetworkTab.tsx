import React, { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, RefreshCw, Radio, Signal, Shield, Activity, Link } from 'lucide-react';

interface WiFiInfo {
  ssid: string;
  bssid: string;
  rssi: number;
  noise: number;
  channel: number;
  band: string;
  txRate: number;
  security: string;
  phyMode: string;
  signalPercent?: number;
  nearbyNetworks: NearbyNetwork[];
  error?: string;
}

interface NearbyNetwork {
  ssid: string;
  bssid: string;
  rssi: number;
  channel: number;
  band: string;
}

function rssiToPercent(rssi: number): number {
  // Convert dBm to percentage (typical range: -30 best to -90 worst)
  if (rssi >= -30) return 100;
  if (rssi <= -90) return 0;
  return Math.round(((rssi + 90) / 60) * 100);
}

function rssiToLabel(rssi: number): { label: string; color: string } {
  const pct = rssiToPercent(rssi);
  if (pct >= 70) return { label: 'Excellent', color: 'var(--status-available)' };
  if (pct >= 50) return { label: 'Good', color: '#4CAF50' };
  if (pct >= 30) return { label: 'Fair', color: 'var(--status-occupied)' };
  return { label: 'Weak', color: 'var(--status-focused)' };
}

function SignalBar({ rssi }: { rssi: number }) {
  const pct = rssiToPercent(rssi);
  const { color } = rssiToLabel(rssi);
  const bars = pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : 1;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: 4 + i * 3,
            borderRadius: 1,
            background: i <= bars ? color : 'rgba(255,255,255,0.1)',
            transition: 'background 0.3s ease',
          }}
        />
      ))}
    </div>
  );
}

export default function NetworkTab() {
  const [wifiInfo, setWifiInfo] = useState<WiFiInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Peer connection state
  const [localInfo, setLocalInfo] = useState<{ addresses: string[]; port: number }>({ addresses: [], port: 0 });
  const [connectIpInput, setConnectIpInput] = useState('');
  const [connectStatus, setConnectStatus] = useState('');

  async function fetchWiFiInfo() {
    try {
      const info = await (window as any).zenstate.getWiFiInfo();
      setWifiInfo(info);
      setLastUpdated(new Date());
    } catch {
      setWifiInfo({ error: 'Failed to fetch WiFi info' } as any);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWiFiInfo();
    (window as any).zenstate.getLocalInfo?.().then((info: { addresses: string[]; port: number }) => {
      setLocalInfo(info);
    }).catch(() => {});
  }, []);

  async function handleConnectIP() {
    const input = connectIpInput.trim();
    if (!input) return;
    const parts = input.split(':');
    const host = parts[0];
    const port = parseInt(parts[1] || '0', 10);
    if (!host || isNaN(port) || port <= 0) {
      setConnectStatus('Invalid format. Use IP:Port');
      return;
    }
    try {
      await (window as any).zenstate.connectToIP(host, port);
      setConnectStatus('Connection initiated');
      setConnectIpInput('');
      setTimeout(() => setConnectStatus(''), 3000);
    } catch {
      setConnectStatus('Connection failed');
    }
  }

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchWiFiInfo, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh]);

  const connectedBSSID = wifiInfo?.bssid || '';
  const sameSSIDNetworks = wifiInfo?.nearbyNetworks?.filter(
    (n) => n.ssid === wifiInfo.ssid && n.ssid !== ''
  ) || [];
  // If SSID is empty (redacted), show all scanned networks as potential extensions
  const extensions = wifiInfo?.ssid
    ? sameSSIDNetworks
    : wifiInfo?.nearbyNetworks || [];

  if (loading) {
    return (
      <div className="fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ marginLeft: 8, color: 'var(--zen-secondary-text)' }}>Scanning WiFi...</span>
      </div>
    );
  }

  if (wifiInfo?.error) {
    return (
      <div className="fade-in" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <WifiOff size={22} color="var(--status-focused)" />
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Network</h2>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <WifiOff size={32} color="var(--zen-tertiary-text)" style={{ marginBottom: 8 }} />
          <div style={{ color: 'var(--zen-secondary-text)', fontSize: 13 }}>
            {wifiInfo.error}
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={fetchWiFiInfo}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const signalInfo = wifiInfo ? rssiToLabel(wifiInfo.rssi) : { label: '', color: '' };
  const signalPct = wifiInfo ? rssiToPercent(wifiInfo.rssi) : 0;

  return (
    <div className="fade-in" style={{ padding: 20, overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wifi size={22} color="var(--zen-primary)" />
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Network</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdated && (
            <span style={{ fontSize: 10, color: 'var(--zen-tertiary-text)' }}>
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            className="btn btn-secondary"
            style={{ padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => { setLoading(true); fetchWiFiInfo(); }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Current Connection Card */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Connected to
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {wifiInfo?.ssid || 'WiFi Network'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <SignalBar rssi={wifiInfo?.rssi || -90} />
            <div style={{ fontSize: 11, color: signalInfo.color, fontWeight: 600, marginTop: 2 }}>
              {signalInfo.label}
            </div>
          </div>
        </div>

        {/* Signal Strength Bar */}
        <div style={{ marginBottom: 14 }}>
          <div style={{
            height: 6,
            borderRadius: 3,
            background: 'rgba(255,255,255,0.06)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${signalPct}%`,
              borderRadius: 3,
              background: `linear-gradient(90deg, var(--status-focused), var(--status-occupied), var(--status-available))`,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 3 }}>
            <span>{wifiInfo?.rssi} dBm</span>
            <span>{signalPct}%</span>
          </div>
        </div>

        {/* Connection Details Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}>
          <DetailItem icon={<Radio size={13} />} label="Channel" value={`${wifiInfo?.channel} (${wifiInfo?.band})`} />
          <DetailItem icon={<Activity size={13} />} label="Speed" value={`${wifiInfo?.txRate} Mbps`} />
          <DetailItem icon={<Shield size={13} />} label="Security" value={wifiInfo?.security || 'Unknown'} />
          <DetailItem icon={<Signal size={13} />} label="Protocol" value={wifiInfo?.phyMode || 'Unknown'} />
          {wifiInfo?.bssid && (
            <DetailItem icon={<Wifi size={13} />} label="BSSID" value={wifiInfo.bssid} span2 />
          )}
        </div>
      </div>

      {/* Access Points / Extensions */}
      {extensions.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              WiFi Access Points
            </h3>
            <span style={{
              fontSize: 10,
              background: 'rgba(255,255,255,0.08)',
              padding: '2px 6px',
              borderRadius: 8,
              color: 'var(--zen-secondary-text)',
            }}>
              {extensions.length} found
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {extensions
              .sort((a, b) => b.rssi - a.rssi)
              .map((net, i) => {
                const isConnected = connectedBSSID && net.bssid === connectedBSSID;
                const netSignal = rssiToLabel(net.rssi);
                const netPct = rssiToPercent(net.rssi);

                return (
                  <div
                    key={net.bssid || i}
                    className="card"
                    style={{
                      padding: 12,
                      border: isConnected ? '1px solid var(--zen-primary)' : '1px solid transparent',
                      position: 'relative',
                    }}
                  >
                    {isConnected && (
                      <div style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        fontSize: 9,
                        background: 'var(--zen-primary)',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontWeight: 600,
                      }}>
                        CONNECTED
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <SignalBar rssi={net.rssi} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            {net.bssid || `Extension ${i + 1}`}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--zen-secondary-text)', marginTop: 3 }}>
                          <span>Ch {net.channel} ({net.band})</span>
                          <span style={{ color: netSignal.color }}>{net.rssi} dBm ({netPct}%)</span>
                          <span style={{ color: netSignal.color }}>{netSignal.label}</span>
                        </div>
                      </div>
                    </div>
                    {/* Mini signal bar */}
                    <div style={{
                      marginTop: 8,
                      height: 3,
                      borderRadius: 2,
                      background: 'rgba(255,255,255,0.06)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${netPct}%`,
                        borderRadius: 2,
                        background: netSignal.color,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {extensions.length === 0 && !wifiInfo?.ssid && (
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ color: 'var(--zen-secondary-text)', fontSize: 12 }}>
            SSID and BSSID require Location Services permission.
          </div>
          <div style={{ color: 'var(--zen-tertiary-text)', fontSize: 11, marginTop: 4 }}>
            Grant location access in System Settings &gt; Privacy &amp; Security &gt; Location Services to identify access point extensions.
          </div>
        </div>
      )}

      {/* Peer Connection Section */}
      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <Link size={14} color="var(--zen-primary)" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Peer Connection</span>
        </div>

        {/* Local Address */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Your Address
          </div>
          {localInfo.addresses.length > 0 ? (
            localInfo.addresses.map((addr) => (
              <div key={addr} style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.04)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                marginBottom: 4,
              }}>
                {addr}:{localInfo.port}
              </div>
            ))
          ) : (
            <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)' }}>
              Not connected to a network
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 4 }}>
            Share this address with team members who can't auto-discover you.
          </div>
        </div>

        <div className="divider" style={{ margin: '12px 0' }} />

        {/* Manual Connect */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Connect to Peer
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="text-input"
              placeholder="IP:Port (e.g. 192.168.1.5:54321)"
              value={connectIpInput}
              onChange={(e) => setConnectIpInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConnectIP(); }}
              style={{ flex: 1, fontSize: 12 }}
            />
            <button
              className="btn btn-primary"
              style={{ fontSize: 11 }}
              onClick={handleConnectIP}
              disabled={!connectIpInput.trim()}
            >
              Connect
            </button>
          </div>
          {connectStatus && (
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginTop: 6 }}>
              {connectStatus}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 6 }}>
            Use this to manually connect to a team member when auto-discovery isn't working.
          </div>
        </div>
      </div>

      {/* Auto-refresh toggle */}
      <div style={{
        marginTop: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontSize: 11,
        color: 'var(--zen-tertiary-text)',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ accentColor: 'var(--zen-primary)' }}
          />
          Auto-refresh every 5s
        </label>
      </div>
    </div>
  );
}

function DetailItem({ icon, label, value, span2 }: { icon: React.ReactNode; label: string; value: string; span2?: boolean }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 8,
      padding: '8px 10px',
      gridColumn: span2 ? '1 / -1' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--zen-tertiary-text)', marginBottom: 3 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  );
}
