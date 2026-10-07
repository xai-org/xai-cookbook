import { NextResponse, type NextRequest } from 'next/server';
import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';
import { AccessToken, type AccessTokenOptions } from 'livekit-server-sdk';

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

// Maps the public agent identifier (the `?agent=` value, derived from the URL slug — e.g.
// `/patient-intake` -> `patient_intake`) to the worker name registered with the agent
// dispatcher. This is an allowlist: only agents listed here can be dispatched, so a client
// can't request an arbitrary worker in the project. Keep it in step with `AGENTS` in
// app/(showcase)/_components/agent-metadata.ts.
//
// Unlike livekit.com, an unknown name is rejected rather than falling back to a default agent —
// this deployment has no general-purpose agent to fall back to, and silently connecting a
// visitor to something other than the agent they asked for is worse than an error.
const AGENT_DISPATCH_NAMES: Record<string, string> = {
  patient_intake: 'xai-patient-intake',
};

export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    if (LIVEKIT_URL === undefined) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    if (LIVEKIT_API_KEY === undefined) {
      throw new Error('LIVEKIT_API_KEY is not defined');
    }
    if (LIVEKIT_API_SECRET === undefined) {
      throw new Error('LIVEKIT_API_SECRET is not defined');
    }

    const s2s = request.nextUrl.searchParams.get('s2s') === 'true';
    const useGateway = request.nextUrl.searchParams.get('useGateway') === 'true';

    // Dispatch the agent requested via `?agent=<name>`, resolving the public name to its worker
    // name through the allowlist.
    const requestedAgent = request.nextUrl.searchParams.get('agent');
    const agentName = requestedAgent ? AGENT_DISPATCH_NAMES[requestedAgent] : undefined;
    if (agentName === undefined) {
      return new NextResponse(`Unknown agent: ${requestedAgent ?? '(none requested)'}`, {
        status: 400,
      });
    }

    const participantName = 'user';
    const participantIdentity = `user_${Math.floor(Math.random() * 10_000)}`;
    const roomName = `demo_${Math.floor(Math.random() * 10_000)}_${Math.floor(Math.random() * 10_000)}`;

    const participantToken = await createParticipantToken(
      { identity: participantIdentity, name: participantName },
      roomName,
      { useGateway, s2s, agentName },
    );

    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantToken,
      participantName,
    };
    const headers = new Headers({
      'Cache-Control': 'no-store',
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
    return new NextResponse('Unknown error', { status: 500 });
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  opts: { useGateway: boolean; s2s: boolean; agentName: string },
): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    ...userInfo,
    ttl: '15m',
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: opts.agentName,
        metadata: JSON.stringify({
          useGateway: opts.useGateway,
        }),
      }),
    ],
  });

  if (opts.s2s) {
    at.attributes = {
      s2s: 'true',
    };
  }

  return at.toJwt();
}
