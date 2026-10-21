'use client';

import { useEffect, useState } from 'react';
import { type AgentState } from '@livekit/components-react';
import Link from 'next/link';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { Badge, Button, cn } from '@/components/bytes';
import { motion } from 'motion/react';

import { agentAccentStyle } from '@/app/(showcase)/_components/agent-themes';
import { AgentAudioVisualizerGrid } from '@/components/voice-agent/agent-audio-visualizer-grid';
import { slugFromAgentName, type AgentMetadata } from './agent-metadata';
import { agentMorphName, MORPH_SPRING } from './utils';

const CARD_BASE =
  'border-separator1 bg-bg1 flex lg:w-[23rem] max-w-full shrink-0 flex-col gap-6 rounded-xl border p-8 origin-center';

interface AgentCardProps {
  agent: AgentMetadata;
  onSelect: (reference: string) => void;
  justExitedAgentName: string | null;
}

export function AgentCard({ agent, onSelect, justExitedAgentName }: AgentCardProps) {
  const reference = slugFromAgentName(agent.name);
  const accentStyle = agentAccentStyle(agent.name);
  const justExited = agent.name === justExitedAgentName;
  // True while this card's own content is fading out, before the parent swaps to the
  // conversation view.
  const [isLeaving, setIsLeaving] = useState(false);
  // Gates the content behind the box's own resize completing when this card is reappearing
  // from a just-closed conversation; otherwise there's nothing to wait for.
  const [contentRevealed, setContentRevealed] = useState(!justExited);

  const handleSelect = () => {
    setIsLeaving(true);
    // Let the content fade fully before the parent swaps to the conversation view — otherwise
    // React batches both changes into one commit and the fade never gets a chance to paint.
    setTimeout(() => onSelect(reference), 100);
  };

  useEffect(() => {
    setTimeout(() => setContentRevealed(true), 150);
  });

  if (agent.comingSoon) {
    return (
      // Fades in/out as the grid itself mounts/unmounts around a conversation starting or
      // ending — the parent AnimatePresence (in AgentShowcase.tsx) keeps this mounted just long
      // enough to play `exit` before the grid is actually removed.
      <motion.div
        layout
        key={agentMorphName(agent.name)}
        layoutId={agentMorphName(agent.name)}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 0.5, scale: 0.99 }}
        exit={{ opacity: 0, scale: 0.5 }}
        transition={{ duration: 0.3 }}
        style={accentStyle}
        className={cn(CARD_BASE, 'relative z-10')}
      >
        <Visualizer state="disconnected" />
        <div className="flex flex-col gap-2">
          <h2 className="text-fg0 text-xl font-semibold">{agent.title}</h2>
          {agent.description && <p className="text-fg3 text-sm">{agent.description}</p>}
        </div>
        <Badge variant="muted" size="large" className="self-start">
          Coming soon
        </Badge>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      key={agentMorphName(agent.name)}
      layoutId={agentMorphName(agent.name)}
      transition={MORPH_SPRING}
      className={cn(CARD_BASE, 'relative z-20')}
      style={{ borderRadius: 12, ...accentStyle }}
    >
      <motion.div
        className="flex flex-1 flex-col gap-6"
        initial={false}
        animate={{ opacity: isLeaving ? 0 : contentRevealed ? 1 : 0 }}
        transition={{ duration: 0.2 }}
      >
        <Visualizer state="connecting" />
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-fg0 text-xl font-semibold">{agent.title}</h2>
            {agent.headlineModel && (
              <Badge variant="muted" size="large">
                {agent.headlineModel}
              </Badge>
            )}
          </div>
          {agent.description && <p className="text-fg3 text-sm">{agent.description}</p>}
        </div>
        <div className="mt-auto flex flex-col gap-3">
          <Button variant="primary" size="sm" className="w-full" onClick={handleSelect}>
            Start conversation
          </Button>
          {agent.repoUrl && (
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href={agent.repoUrl} target="_blank" rel="noopener noreferrer">
                <SiGithub className="size-4" />
                Clone agent
              </Link>
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

interface VisualizerProps {
  state: AgentState;
}

function Visualizer({ state }: VisualizerProps) {
  return (
    <div className="border-separator1 mx-auto grid w-fit place-content-center rounded-lg border p-3">
      <AgentAudioVisualizerGrid
        size="md"
        radius={3}
        interval={80}
        rowCount={11}
        columnCount={11}
        state={state}
        className="*:bg-bg3 *:data-[lk-highlighted=true]:bg-fgAccentPrimary1 aspect-square gap-[9px] *:size-[3px] *:rounded-none *:data-[lk-highlighted=true]:scale-125 *:data-[lk-highlighted=true]:shadow-[0px_0px_6.8px_2px_var(--agent-accent-glow)]"
      />
    </div>
  );
}
