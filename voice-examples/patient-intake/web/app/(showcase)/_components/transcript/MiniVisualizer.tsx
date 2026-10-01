import { type CSSProperties } from 'react';
import { type AgentState, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { arc, motion } from 'motion/react';

import { AgentAudioVisualizerGrid } from '@/components/agents-ui/agent-audio-visualizer-grid';
import { MORPH_SPRING } from '../utils';

export interface MiniVisualizerProps {
  state: AgentState;
  moodColor?: string;
  audioTrack?: TrackReferenceOrPlaceholder;
  disableArcTransition?: boolean;
}

/**
 * Shares `layoutId={morphName}` with every other spot this visualizer can appear — the "not yet
 * connected" placeholder centered in `AgentConversation`, and whichever transcript row is currently
 * latest here — so Motion animates it smoothly between them instead of popping.
 */
export function MiniVisualizer({
  state,
  moodColor,
  audioTrack,
  disableArcTransition = false,
}: MiniVisualizerProps) {
  const style: CSSProperties = {
    borderRadius: 8,
    '--mood-color': moodColor,
  } as React.CSSProperties;

  return (
    // `layout="position"` avoids this element ever attempting its own size/scale FLIP.
    <motion.div
      layout="position"
      layoutId="mini-visualizer"
      transition={
        disableArcTransition
          ? MORPH_SPRING
          : {
              type: 'spring',
              bounce: 0.1,
              visualDuration: 0.5,
              path: arc({
                strength: 0.5,
                peak: 0.8,
              }),
            }
      }
      className="border-separator1 -mt-2 w-fit rounded-lg border p-[9px]"
      style={style}
    >
      <AgentAudioVisualizerGrid
        size="sm"
        radius={2}
        interval={80}
        rowCount={3}
        columnCount={3}
        audioTrack={audioTrack}
        state={state === 'disconnected' || state === 'initializing' ? 'connecting' : state}
        // The accent fallback reads `--lk-color-fgAccentPrimary1` rather than Tailwind's
        // `--color-fgAccentPrimary1`. bytes-core declares its palette in `@theme inline`, so
        // `--color-*` is emitted on `:root` and computes there — it freezes the root's accent
        // and ignores a per-agent override further down the tree. Inlining the `oklch()` the
        // way the named `bg-fgAccentPrimary1` utility does keeps it resolving at this element.
        className="*:bg-bg3 gap-[6.5px] *:size-[3px] *:rounded-none *:shadow-none *:data-[lk-highlighted=true]:scale-125 *:data-[lk-highlighted=true]:bg-[var(--mood-color,oklch(var(--lk-color-fgAccentPrimary1)))] *:data-[lk-highlighted=true]:shadow-none"
      />
    </motion.div>
  );
}
