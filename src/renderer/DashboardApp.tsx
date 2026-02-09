import React, { useState, useEffect, useCallback } from 'react';
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
      startTimer: (taskLabel: string, category?: string) => void;
      stopTimer: () => void;
      pauseTimer: () => void;
      resumeTimer: () => void;
      openDashboard: () => void;
      closePopover: () => void;
      quit: () => void;
      login: (user: User) => void;
      getRecords: (month?: string) => Promise<DailyRecord[]>;
      deleteSession: (sessionId: string, date: string) => Promise<boolean>;
      updateSession: (sessionId: string, date: string, updates: unknown) => Promise<boolean>;
      exportCSV: (month: string) => Promise<string>;
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

    return () => {
      window.zenstate.removeAllListeners(IPC.PEER_DISCOVERED);
      window.zenstate.removeAllListeners(IPC.PEER_UPDATED);
      window.zenstate.removeAllListeners(IPC.PEER_LOST);
      window.zenstate.removeAllListeners(IPC.TIMER_UPDATE);
    };
  }, [currentUser]);

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

  if (!currentUser) {
    return (
      <div className="dashboard" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="pulse" style={{ color: 'var(--zen-secondary-text)' }}>Loading...</div>
      </div>
    );
  }

  return (
    <DashboardView
      currentUser={currentUser}
      peers={peers}
      timerState={timerState}
      records={records}
      onRefreshRecords={refreshRecords}
      onStatusChange={handleStatusChange}
      onUserUpdate={handleUserUpdate}
    />
  );
}
