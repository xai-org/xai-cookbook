'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { ArrowLeftIcon, Badge, Button, IconButton } from '@/components/bytes';
import { motion } from 'motion/react';

import { agentAccentStyle } from '@/app/(showcase)/_components/agent-themes';
import { AgentControlBar } from '@/components/agents-ui/agent-control-bar';
import { type AgentMetadata } from './agent-metadata';
import { AgentSession } from './AgentSession';
import { AgentTranscript } from './transcript/AgentTranscript';
import { MORPH_SPRING } from './utils';

interface AgentConversationProps {
  agent: AgentMetadata;
  morphName: string;
  onLeave: () => void;
  /**
   * True when this panel arrived via a click on a grid card (a real box morph is playing). False
   * when this panel is the initial render of a direct page load — in that case there's no prior
   * element to morph from, so `onLayoutAnimationComplete` below never fires, and gating the content
   * behind it would leave the panel blank forever.
   */
  isMorphing: boolean;
}

export function AgentConversation({
  agent,
  morphName,
  isMorphing,
  onLeave,
}: AgentConversationProps) {
  const [contentRevealed, setContentRevealed] = useState(!isMorphing);
  // True while the content is fading out, before the box starts morphing back into the grid
  // card — mirrors ActiveAgentCard's handleSelect on the enter side.
  const [isLeaving, setIsLeaving] = useState(false);
  const isLeavingRef = useRef(false);
  // The SDK disconnects the room on page unload (refresh, close, navigate away),
  // which flips `connectionState` and would otherwise trigger the exit morph +
  // router.push below on a page that's already being torn down — a visible
  // flash of the grid mid-reload. Suppress that specific case.
  const isUnloadingRef = useRef(false);

  const handleLeave = useCallback(() => {
    // The disconnect button and the connection-state effect below can both end up calling this
    // for the same disconnect (the button ends the session, which then flips connection state) —
    // guard so we don't schedule the actual leave twice.
    if (isLeavingRef.current || isUnloadingRef.current) {
      return;
    }
    isLeavingRef.current = true;
    setIsLeaving(true);
    // Let the content fade fully before the box starts morphing back into the grid card —
    // otherwise React batches both changes into one commit and the fade never gets a chance to
    // paint (same reasoning as ActiveAgentCard.handleSelect on the enter side).
    setTimeout(onLeave, 150);
  }, [onLeave]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return (
    <motion.div
      layout
      layoutId={morphName}
      transition={MORPH_SPRING}
      style={{ borderRadius: 12, ...agentAccentStyle(agent.name) }}
      onLayoutAnimationComplete={() => setContentRevealed(true)}
      className="border-separator1 mx-auto flex h-[65vh] max-h-[700px] min-h-[440px] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border"
    >
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        layout
        initial={false}
        animate={{ opacity: isLeaving ? 0 : contentRevealed ? 1 : 0 }}
        transition={{ duration: isLeaving ? 0.15 : 0.3 }}
      >
        <div className="border-separator1 bg-bg1 flex shrink-0 items-center justify-between gap-3 border-b px-6 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              variant="ghost"
              label="Back to agents"
              tooltip={false}
              onClick={handleLeave}
            >
              <ArrowLeftIcon />
            </IconButton>
            <h2 className="text-fg0 truncate text-lg font-semibold">{agent.title}</h2>
            {agent.headlineModel && (
              <Badge variant="muted" size="large" className="shrink-0 tracking-wider">
                {agent.headlineModel.toUpperCase()}
              </Badge>
            )}
          </div>
          {agent.repoUrl && (
            <Button variant="ghost" className="shrink-0" asChild>
              <Link href={agent.repoUrl} target="_blank" rel="noopener noreferrer">
                <SiGithub className="size-4" />
                Clone agent
              </Link>
            </Button>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-8 pt-6 pb-8">
          <AgentSession agentName={agent.name} onLeave={handleLeave}>
            <AgentTranscript className="min-h-0 w-full flex-1" agentName={agent.name} />
            <div className="flex flex-col items-center justify-center gap-4">
              <AgentControlBar
                variant="livekit"
                controls={{
                  microphone: true,
                  leave: true,
                  camera: false,
                  screenShare: false,
                  chat: false,
                }}
                isConnected={true}
                onDisconnect={onLeave}
                className="w-84"
              />
            </div>
          </AgentSession>
        </div>
      </motion.div>
    </motion.div>
  );
}
