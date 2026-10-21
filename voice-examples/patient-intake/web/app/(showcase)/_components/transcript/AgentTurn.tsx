import type { AgentState, TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { cn } from '@/components/bytes';

import { AgentMessage } from './AgentMessage';
import { MiniVisualizer } from './MiniVisualizer';
import { ToolTag } from './ToolTag';

// Fixed gutter every agent/tool row reserves for the visualizer, whether or not this particular
// row is currently hosting it — keeps agent/tool content aligned consistently regardless of which
// row the visualizer (a shared layoutId'd element, see MiniVisualizer) currently occupies.
const VISUALIZER_GUTTER_WIDTH = 'w-[42px]';

interface AgentTurnProps {
  state: AgentState;
  kind: 'speech' | 'tool';
  message?: string;
  toolName?: string;
  expression?: string;
  audioTrack?: TrackReferenceOrPlaceholder;
  latestMoodColor?: string;
  isFirstItem: boolean;
  isLatestAction: boolean;
}

export function AgentTurn({
  kind,
  state,
  message,
  toolName,
  expression,
  audioTrack,
  latestMoodColor,
  isFirstItem,
  isLatestAction,
}: AgentTurnProps) {
  const isToolCall = kind === 'tool';

  return (
    <div className="flex items-start gap-3">
      {/* Always reserves the same width whether or not it's hosting the
          visualizer, so agent/tool content stays aligned as the visualizer — a
          shared layoutId'd element — moves between rows. Motion animates it into
          position on its own; no manual position tracking needed. */}
      <div
        aria-hidden
        className={cn(
          // `items-start` guards MiniVisualizer against inheriting flex's default cross-axis
          // `stretch` for an auto-height child — it should always hug its own fixed dot-grid
          // size, never fill unexpected gutter height.
          'flex shrink-0 items-start justify-center',
          VISUALIZER_GUTTER_WIDTH,
        )}
      >
        {isLatestAction && (
          <MiniVisualizer
            state={state}
            audioTrack={audioTrack}
            moodColor={latestMoodColor}
            disableArcTransition={!isFirstItem}
          />
        )}
      </div>
      {isToolCall ? (
        <ToolTag name={toolName!} />
      ) : (
        <AgentMessage expression={expression!} message={message!} />
      )}
    </div>
  );
}
