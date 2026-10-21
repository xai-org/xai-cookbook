import { useEffect, useRef } from 'react';
import { useSessionContext } from '@livekit/components-react';
import { useKrispNoiseFilter } from '@livekit/components-react/krisp';

import { SessionProvider } from '@/components/SessionProvider';

interface AgentHooksProps {
  onLeave: () => void;
}

function AgentHooks({ onLeave }: AgentHooksProps) {
  const session = useSessionContext();
  const hasConnectedRef = useRef(false);
  const { setNoiseFilterEnabled } = useKrispNoiseFilter();

  useEffect(() => {
    session.start({ tracks: { microphone: { enabled: true } } });
    setNoiseFilterEnabled(true);
    return () => {
      session.end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session.isConnected) {
      hasConnectedRef.current = true;
    } else if (hasConnectedRef.current && session.connectionState !== 'connecting') {
      onLeave();
    }
  }, [session.isConnected, session.connectionState, onLeave]);

  return <></>;
}

interface AgentSessionProps {
  agentName: string;
  children: React.ReactNode;
  onLeave: () => void;
}

export function AgentSession({ agentName, children, onLeave }: AgentSessionProps) {
  return (
    <SessionProvider agentName={agentName}>
      <AgentHooks onLeave={onLeave} />
      {children}
    </SessionProvider>
  );
}
