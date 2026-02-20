import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, AvailabilityStatus, DailyRecord, IPC } from '../shared/types';
import DashboardView from './views/DashboardView';

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
      startTimer: (taskLabel: string, category?: string, targetDuration?: number) => void;
      stopTimer: () => void;
      pauseTimer: () => void;
      resumeTimer: () => void;
      openDashboard: () => void;
      closePopover: () => void;
      quit: () => void;
      login: (user: User) => void;
      signOut: () => void;
      getRecords: (month?: string) => Promise<DailyRecord[]>;
      deleteSession: (sessionId: string, date: string) => Promise<boolean>;
      updateSession: (sessionId: string, date: string, updates: unknown) => Promise<boolean>;
      exportCSV: (month: string) => Promise<string>;
      getAppVersion: () => Promise<string>;
      resetAllData: () => Promise<boolean>;
      installUpdate: () => void;
      checkForUpdate: () => Promise<void>;
      getLoginItemSettings: () => Promise<boolean>;
      setLoginItemSettings: (enabled: boolean) => void;
      on: (channel: string, callback: (...args: unknown[]) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}

interface TimerState {
  elapsed: number;
  isRunning: boolean;
  isPaused: boolean;
  taskLabel: string;
  category?: string;
  targetDuration?: number;
  remaining?: number;
}

export default function DashboardApp() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [peers, setPeers] = useState<User[]>([]);
  const [timerState, setTimerState] = useState<TimerState>({
    elapsed: 0,
    isRunning: false,
    isPaused: false,
    taskLabel: '',
  });
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const prevTimerRunning = useRef(false);

  useEffect(() => {
    async function init() {
      const user = await window.zenstate.getUser();
      setCurrentUser(user);
      if (user) {
        const peerList = await window.zenstate.getPeers();
        setPeers(peerList);
      }
      const allRecords = await window.zenstate.getRecords() as DailyRecord[];
      setRecords(allRecords);
    }
    init();
  }, []);

  useEffect(() => {
    window.zenstate.on(IPC.PEER_DISCOVERED, (peer: unknown) => {
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
      // Also update current user if it's us
      if (currentUser && p.id === currentUser.id) {
        setCurrentUser(p);
      }
    });

    window.zenstate.on(IPC.PEER_LOST, (peerId: unknown) => {
      setPeers((prev) => prev.filter((p) => p.id !== (peerId as string)));
    });

    window.zenstate.on(IPC.TIMER_UPDATE, (data: unknown) => {
      setTimerState(data as TimerState);
    });

    // Listen for emergency access grant/revoke
    window.zenstate.on(IPC.EMERGENCY_ACCESS, (granted: unknown) => {
      setCurrentUser((prev) => prev ? { ...prev, canSendEmergency: granted as boolean } : prev);
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
      window.zenstate.removeAllListeners(IPC.EMERGENCY_ACCESS);
      window.zenstate.removeAllListeners('update:downloaded');
    };
  }, [currentUser]);

  // Auto-refresh records when timer stops
  useEffect(() => {
    if (prevTimerRunning.current && !timerState.isRunning) {
      // Timer just stopped — refresh records after a brief delay for persistence
      setTimeout(async () => {
        const allRecords = await window.zenstate.getRecords() as DailyRecord[];
        setRecords(allRecords);
      }, 500);
    }
    prevTimerRunning.current = timerState.isRunning || timerState.isPaused;
  }, [timerState.isRunning, timerState.isPaused]);

  const refreshRecords = useCallback(async () => {
    const allRecords = await window.zenstate.getRecords() as DailyRecord[];
    setRecords(allRecords);
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
    window.zenstate.signOut();
    setCurrentUser(null);
    setPeers([]);
  }, []);

  if (!currentUser) {
    return (
      <div className="dashboard" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="pulse" style={{ color: 'var(--zen-secondary-text)' }}>Loading...</div>
      </div>
    );
  }

  return (
    <>
      {/* Update notification banner */}
      {updateAvailable && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 200,
          background: 'var(--zen-primary)',
          color: 'white',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
          fontWeight: 500,
        }}>
          <span style={{ flex: 1 }}>
            ZenState v{updateAvailable} is ready. Restart to update.
          </span>
          <button
            onClick={() => window.zenstate.installUpdate()}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.4)',
              color: 'white',
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Restart Now
          </button>
          <button
            onClick={() => setUpdateAvailable(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontSize: 14,
              padding: 2,
            }}
          >
            ✕
          </button>
        </div>
      )}

      <DashboardView
        currentUser={currentUser}
        peers={peers}
        timerState={timerState}
        records={records}
        onRefreshRecords={refreshRecords}
        onStatusChange={handleStatusChange}
        onUserUpdate={handleUserUpdate}
        onSignOut={handleSignOut}
      />
    </>
  );
}
