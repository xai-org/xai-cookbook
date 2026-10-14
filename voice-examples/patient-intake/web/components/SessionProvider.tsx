'use client';

import { useMemo } from 'react';
import {
  SessionProvider as LiveKitSessionProvider,
  RoomAudioRenderer,
  useSession,
} from '@livekit/components-react';
import { TokenSource } from 'livekit-client';

interface SessionProviderProps {
  children: React.ReactNode;
  /** Dispatch a specific agent (from the `?agent=` query param) instead of the default. */
  agentName?: string;
}

export function SessionProvider({ children, agentName }: SessionProviderProps) {
  const tokenSource = useMemo(() => {
    const params = new URLSearchParams({ useGateway: 'true' });
    if (agentName) {
      params.set('agent', agentName);
    }
    return TokenSource.endpoint(`/api/agent/connection_details?${params.toString()}`);
  }, [agentName]);
  const session = useSession(tokenSource);

  return (
    <LiveKitSessionProvider session={session}>
      {children}
      <RoomAudioRenderer />
    </LiveKitSessionProvider>
  );
}
