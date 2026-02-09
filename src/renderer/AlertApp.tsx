import React, { useState, useEffect } from 'react';
import AlertView from './views/AlertView';

interface AlertData {
  type: 'meetingRequest' | 'emergencyRequest' | 'meetingResponse';
  from: string;
  senderId: string;
  message?: string;
  accepted?: boolean;
}

export default function AlertApp() {
  const [alertData, setAlertData] = useState<AlertData | null>(null);

  useEffect(() => {
    window.zenstate.on('alert-data', (data: unknown) => {
      setAlertData(data as AlertData);
    });

    return () => {
      window.zenstate.removeAllListeners('alert-data');
    };
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
      onRespond={(accepted, message) => {
        window.zenstate.respondMeetingRequest(alertData.senderId, accepted, message);
        window.close();
      }}
      onDismiss={() => {
        window.close();
      }}
    />
  );
}
