import React, { useState, useEffect } from 'react';
import AlertView from './views/AlertView';

interface AlertData {
  type: 'meetingRequest' | 'emergencyRequest' | 'meetingResponse' | 'timerComplete' | 'breakReminder' | 'longRunGuard' | 'timesheetConfirm' | 'idlePrompt';
  from: string;
  senderId: string;
  message?: string;
  accepted?: boolean;
  targetDuration?: number;
  elapsedSeconds?: number;
  lastActivityAt?: string;
}

export default function AlertApp() {
  const [alertData, setAlertData] = useState<AlertData | null>(null);

  useEffect(() => {
    let eventArrived = false;
    const off = window.zenstate.on('alert-data', (data: unknown) => {
      eventArrived = true;
      setAlertData(data as AlertData);
    });
    window.zenstate.alertGetData().then((cached: unknown) => {
      if (!eventArrived && cached) setAlertData(cached as AlertData);
    }).catch(() => {});
    return off;
  }, []);

  if (!alertData) {
    return null;
  }

  return (
    <AlertView
      type={alertData.type}
      from={alertData.from}
      senderId={alertData.senderId}
      message={alertData.message}
      accepted={alertData.accepted}
      targetDuration={alertData.targetDuration}
      elapsedSeconds={alertData.elapsedSeconds}
      lastActivityAt={alertData.lastActivityAt}
      onRespond={(accepted, message) => {
        window.zenstate.respondMeetingRequest(alertData.senderId, accepted, message);
        window.close();
      }}
      onDismiss={() => {
        window.close();
      }}
      onLongRunResponse={(action, stopAtIso) => {
        window.zenstate.timerLongRunRespond({ action, stopAtIso });
      }}
      onIdleResponse={(action, stopAtIso, enableMeetingMode) => {
        window.zenstate.timerIdleRespond({ action, stopAtIso, enableMeetingMode });
      }}
      onTimesheetConfirm={(action, hours, notes) => {
        window.zenstate.timerTimesheetConfirm({ action, hours, notes });
      }}
    />
  );
}
