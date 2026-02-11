import React, { useState, useEffect, useCallback } from 'react';
import { User, AvailabilityStatus, IPC } from '../shared/types';
import LoginView from './views/LoginView';
import MenuBarView from './views/MenuBarView';
import SettingsView from './views/SettingsView';

// Type declaration for the preload bridge
declare global {
  interface Window {
    zenstate: {
      getUser: () => Promise<User | null>;
      saveUser: (user: User) => Promise<boolean>;
      getPeers: () => Promise<User[]>;
      updateStatus: (status: AvailabilityStatus) => void;
      updateUser: (updates: Partial<User>) => void;
      sendMeetingRequest: (userId: string, message?: string) => void;
      cancelMeetingRequest: (userId: string) => void;
      respondMeetingRequest: (userId: string, accepted: boolean, message?: string) => void;
      sendEmergencyRequest: (userId: string, message?: string) => void;
      grantEmergencyAccess: (userId: string, granted: boolean) => void;
      startTimer: (taskLabel: string, category?: string) => void;
      stopTimer: () => void;
      pauseTimer: () => void;
      resumeTimer: () => void;
      openDashboard: () => void;
      closePopover: () => void;
      quit: () => void;
      login: (user: User) => void;
      getRecords: (month?: string) => Promise<unknown>;
      deleteSession: (sessionId: string, date: string) => Promise<boolean>;
      updateSession: (sessionId: string, date: string, updates: unknown) => Promise<boolean>;
      exportCSV: (month: string) => Promise<string>;
      getLoginItemSettings?: () => Promise<boolean>;
      setLoginItemSettings?: (enabled: boolean) => void;
      signOut?: () => void;
      on: (channel: string, callback: (...args: unknown[]) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}

type View = 'main' | 'settings';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [peers, setPeers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('main');
  const [timerState, setTimerState] = useState({
    elapsed: 0,
    isRunning: false,
    isPaused: false,
    taskLabel: '',
    category: undefined as string | undefined,
  });
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    async function init() {
      const user = await window.zenstate.getUser();
      setCurrentUser(user);
      if (user) {
        const peerList = await window.zenstate.getPeers();
        setPeers(peerList);
      }
      setLoading(false);
    }
    init();
  }, []);

  // Listen for networking events
  useEffect(() => {
    window.zenstate.on(IPC.PEER_DISCOVERED, (peer: unknown) => {
      const p = peer as User;
      setPeers((prev) => {
        const existing = prev.findIndex((x) => x.id === p.id);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = p;
          return updated;
        }
        return [...prev, p];
      });
    });

    window.zenstate.on(IPC.PEER_UPDATED, (peer: unknown) => {
      const p = peer as User;
      setPeers((prev) => {
        const idx = prev.findIndex((x) => x.id === p.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = p;
          return updated;
        }
        return [...prev, p];
      });
    });

    window.zenstate.on(IPC.PEER_LOST, (peerId: unknown) => {
      setPeers((prev) => prev.filter((p) => p.id !== (peerId as string)));
    });

    window.zenstate.on(IPC.TIMER_UPDATE, (data: unknown) => {
      setTimerState(data as typeof timerState);
    });

    // Listen for update notifications
    window.zenstate.on('update:downloaded', (data: unknown) => {
      const info = data as { version: string };
      setUpdateAvailable(info.version);
    });

    return () => {
      window.zenstate.removeAllListeners(IPC.PEER_DISCOVERED);
      window.zenstate.removeAllListeners(IPC.PEER_UPDATED);
      window.zenstate.removeAllListeners(IPC.PEER_LOST);
      window.zenstate.removeAllListeners(IPC.TIMER_UPDATE);
      window.zenstate.removeAllListeners('update:downloaded');
    };
  }, []);

  const handleLogin = useCallback(async (user: User) => {
    await window.zenstate.saveUser(user);
    window.zenstate.login(user);
    setCurrentUser(user);
  }, []);

  const handleStatusChange = useCallback((status: AvailabilityStatus) => {
    if (!currentUser) return;
    const updated = { ...currentUser, status };
    setCurrentUser(updated);
    window.zenstate.updateStatus(status);
  }, [currentUser]);

  const handleUserUpdate = useCallback((updates: Partial<User>) => {
    if (!currentUser) return;
    const updated = { ...currentUser, ...updates };
    setCurrentUser(updated);
    window.zenstate.updateUser(updates);
    window.zenstate.saveUser(updated);
  }, [currentUser]);

  const handleSignOut = useCallback(() => {
    window.zenstate.signOut?.();
    setCurrentUser(null);
    setPeers([]);
    setView('main');
  }, []);

  if (loading) {
    return <div className="popover" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="pulse" style={{ color: 'var(--zen-secondary-text)' }}>Loading...</div>
    </div>;
  }

  if (!currentUser) {
    return <LoginView onLogin={handleLogin} />;
  }

  if (view === 'settings') {
    return (
      <SettingsView
        currentUser={currentUser}
        peers={peers}
        onUserUpdate={handleUserUpdate}
        onSignOut={handleSignOut}
        onBack={() => setView('main')}
      />
    );
  }

  return (
    <>
      {/* Update notification banner */}
      {updateAvailable && (
        <div style={{
          background: 'var(--zen-primary)',
          color: 'white',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          fontWeight: 500,
          borderRadius: '12px 12px 0 0',
        }}>
          <span style={{ flex: 1 }}>v{updateAvailable} ready — restart to update</span>
          <button
            onClick={() => (window as any).zenstate.installUpdate()}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.4)',
              color: 'white',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Restart
          </button>
        </div>
      )}
      <MenuBarView
        currentUser={currentUser}
        peers={peers}
        timerState={timerState}
        onStatusChange={handleStatusChange}
        onUserUpdate={handleUserUpdate}
        onOpenSettings={() => setView('settings')}
      />
    </>
  );
}
