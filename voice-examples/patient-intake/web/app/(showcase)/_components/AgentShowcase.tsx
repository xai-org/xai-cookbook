'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { Button, cn } from '@/components/bytes';
import { AnimatePresence } from 'motion/react';

import { AGENTS, resolveActiveAgent } from './agent-metadata';
import { AgentCard } from './AgentCards';
import { AgentConversation } from './AgentConversation';
import { agentMorphName, slugFromPathname } from './utils';

export function AgentShowcase() {
  const pathname = usePathname();
  const router = useRouter();
  const urlReference = slugFromPathname(pathname);

  const [reference, setReference] = useState(urlReference);
  useEffect(() => {
    setReference(urlReference);
  }, [urlReference]);

  const activeAgent = reference ? (resolveActiveAgent(reference) ?? null) : null;
  const activeAgentName = activeAgent?.name ?? null;

  // Set right before leaving so the grid knows which specific card is reappearing from a
  // just-closed conversation — only that card gates its content reveal behind the box's own
  // layout animation completing; every other card (including on true first page load) renders
  // immediately.
  const [justExitedAgentName, setJustExitedAgentName] = useState<string | null>(null);

  // True once a card has actually been clicked — distinguishes "opened via the grid" (a real box
  // morph plays, so the panel's content should wait for it) from "loaded straight into a
  // conversation URL" (no prior card, no morph ever starts, so onLayoutAnimationComplete would
  // never fire and gated content would stay invisible forever).
  const [enteredViaClick, setEnteredViaClick] = useState(false);

  const enterConversation = useCallback(
    (ref: string) => {
      setEnteredViaClick(true);
      setReference(ref);
      router.push(`/${ref}`, { scroll: false });
    },
    [router],
  );

  const leaveConversation = useCallback(() => {
    setJustExitedAgentName(activeAgentName);
    setReference(null);
    router.push('/', { scroll: false });
  }, [router, activeAgentName]);

  const active = AGENTS.filter((agent) => !agent.comingSoon);
  const comingSoon = AGENTS.filter((agent) => agent.comingSoon);
  const split = Math.ceil(comingSoon.length / 2);
  const agents = [...comingSoon.slice(0, split), ...active, ...comingSoon.slice(split)];

  return (
    // `min-h-svh`, not livekit.com's `calc(100svh-8rem)`: that subtraction reserves room for the
    // marketing header and footer, which this app doesn't render, and leaves the card sitting
    // half a chrome's height above centre.
    <div className="text-fg1 relative z-10 flex min-h-svh w-full flex-col justify-center px-6 py-12">
      {/* `initial={false}` skips every nested motion component's enter animation (including the
          coming-soon cards' scale-in) on this component's own very first render — but has no
          effect on later mounts, so the grid still animates in normally when it reappears after a
          conversation closes. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {activeAgent ? (
          // Higher than the grid's own z-30 below so the panel — and the active card mid-morph
          // into it — always render above the grid while it's still fading out underneath during
          // the AnimatePresence overlap window.
          <div key={activeAgent.name} className="relative z-40 flex w-full justify-center">
            <AgentConversation
              agent={activeAgent}
              isMorphing={enteredViaClick}
              morphName={agentMorphName(activeAgent.name)}
              onLeave={leaveConversation}
            />
          </div>
        ) : (
          <div key="grid" className="relative z-30 flex w-full flex-col items-center gap-10">
            {/* livekit.com pins each card to a fixed slot in a three-column grid, which only
                centers correctly at exactly three. This deployment sizes itself to however many
                agents `AGENTS` holds, so the cards are centered as a row instead. */}
            <div className="mx-auto flex w-fit flex-col items-center justify-center gap-10 lg:flex-row lg:items-stretch lg:gap-6">
              {agents.map((agent) => (
                <div
                  key={agent.name}
                  className={cn(
                    'grid place-items-center',
                    !agent.comingSoon && 'lg:order-0 order-first',
                  )}
                >
                  <AgentCard
                    agent={agent}
                    onSelect={enterConversation}
                    justExitedAgentName={justExitedAgentName}
                  />
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link
                href="https://github.com/livekit/agents"
                target="_blank"
                rel="noopener noreferrer"
              >
                <SiGithub className="size-4" />
                View on GitHub
              </Link>
            </Button>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
