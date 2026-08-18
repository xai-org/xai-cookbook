'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AGENT_SUGGESTIONS_ATTRIBUTE,
  parseSuggestions,
  TEXT_INPUT_TOPIC,
  type Suggestion,
} from '@/app/(showcase)/_components/suggestions';
import { useAgentSession } from '@/app/(showcase)/_components/use-agent-session';
import {
  useParticipantAttributes,
  useRoomContext,
  useTranscriptions,
  useVoiceAssistant,
} from '@livekit/components-react';
import { cn } from '@/components/bytes';
import { AnimatePresence, motion } from 'motion/react';

import { agentAccentStyle } from '@/app/(showcase)/_components/agent-themes';
import { Shimmer } from '@/components/shimmer';
import { MORPH_SPRING, getMoodColor } from '../utils';
import { AgentTurn } from './AgentTurn';
import { MiniVisualizer } from './MiniVisualizer';
import { Suggestions } from './Suggestions';
import { UserMessage } from './UserMessage';

type TimelineItem =
  | { kind: 'speech'; id: string; ts: number; name: string; text: string; expression?: string }
  | { kind: 'tool'; id: string; ts: number; name: string; args: string };

// Attribute keys published on the `lk.transcription` text stream by the agents SDK.
const SEGMENT_ID_ATTRIBUTE = 'lk.segment_id';
const EXPRESSION_ATTRIBUTE = 'lk.expression';

const TRANSCRIPT_INSET = 'px-8 lg:pr-20';

/** `lk.expression` is a JSON object (`{"value": "speak warmly"}`) so fields can be added later. */
function parseExpression(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'value' in parsed) {
      const value = (parsed as { value: unknown }).value;
      return typeof value === 'string' ? value : undefined;
    }
  } catch {
    // tolerate a malformed attribute rather than dropping the segment
  }
  return undefined;
}

interface AgentTranscriptProps {
  className?: string;
  /** Agent in this conversation, so an accent-themed one can opt out of the mood tint. */
  agentName?: string;
}

export function AgentTranscript({ className, agentName }: AgentTranscriptProps) {
  const { agent, state, audioTrack } = useVoiceAssistant();
  const { attributes } = useParticipantAttributes({ participant: agent });
  const room = useRoomContext();
  const { toolCalls } = useAgentSession();
  // Stream-based transcriptions (`lk.transcription` topic). Unlike the deprecated
  // rtc Transcription API, this is the channel the SDK strips expressive markup
  // from before publishing, and its attributes carry the segment's leading
  // delivery/emotion tag as `lk.expression`.
  const transcriptionStreams = useTranscriptions({ room });

  // Log each segment's leading delivery/emotion tag (`lk.expression`) for debugging.
  const loggedExpressionsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const stream of transcriptionStreams) {
      const attributes = stream.streamInfo.attributes ?? {};
      const segmentId = attributes[SEGMENT_ID_ATTRIBUTE] ?? stream.streamInfo.id;
      const expression = parseExpression(attributes[EXPRESSION_ATTRIBUTE]);
      if (expression && !loggedExpressionsRef.current.has(segmentId)) {
        loggedExpressionsRef.current.add(segmentId);
        console.log('[mood] lk.expression:', expression);
      }
    }
  }, [transcriptionStreams]);

  const rawSuggestions = attributes?.[AGENT_SUGGESTIONS_ATTRIBUTE];
  const suggestions = useMemo(() => parseSuggestions(rawSuggestions), [rawSuggestions]);
  const [dismissed, setDismissed] = useState(false);
  const [sentMessages, setSentMessages] = useState<{ id: string; ts: number; text: string }[]>([]);
  const sentCountRef = useRef(0);
  const showSuggestions = !dismissed && suggestions.length > 0 && state === 'listening';

  useEffect(() => {
    setDismissed(false);
  }, [rawSuggestions, state]);

  const handleSuggestionClick = useCallback(
    (suggestion: Suggestion) => {
      setDismissed(true);
      const ts = Date.now();
      setSentMessages((prev) => [
        ...prev,
        { id: `sent-${ts}-${sentCountRef.current++}`, ts, text: suggestion.value },
      ]);
      void room?.localParticipant?.sendText(suggestion.value, { topic: TEXT_INPUT_TOPIC });
    },
    [room],
  );

  const timeline = useMemo<TimelineItem[]>(() => {
    // One item per transcript segment. A delta stream (agent speech) grows a single
    // stream per segment; a non-delta stream (user STT) publishes a fresh stream per
    // update sharing the same segment id - later entries replace earlier ones.
    const segments = new Map<string, TimelineItem & { kind: 'speech' }>();
    for (const stream of transcriptionStreams) {
      if (!stream.text) {
        continue;
      }
      const attributes = stream.streamInfo.attributes ?? {};
      const segmentId = attributes[SEGMENT_ID_ATTRIBUTE] ?? stream.streamInfo.id;
      const previous = segments.get(segmentId);
      segments.set(segmentId, {
        kind: 'speech',
        id: segmentId,
        ts: previous?.ts ?? stream.streamInfo.timestamp,
        name:
          stream.participantInfo.identity === room?.localParticipant?.identity ? 'you' : 'agent',
        text: stream.text,
        expression: parseExpression(attributes[EXPRESSION_ATTRIBUTE]) ?? previous?.expression,
      });
    }

    const items: TimelineItem[] = [...segments.values()];
    for (const call of toolCalls) {
      items.push({
        kind: 'tool',
        id: `tool-${call.id}`,
        ts: call.receivedAtMs,
        name: call.name,
        args: call.args,
      });
    }
    for (const sent of sentMessages) {
      items.push({ kind: 'speech', id: sent.id, ts: sent.ts, name: 'you', text: sent.text });
    }
    return items.sort((a, b) => a.ts - b.ts);
  }, [transcriptionStreams, room, toolCalls, sentMessages]);

  const latestActionId = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item && (item.kind === 'tool' || (item.kind === 'speech' && item.name === 'agent'))) {
        return item.id;
      }
    }
    return null;
  }, [timeline]);

  // Mood accent for the visualizer dots — the same latest transcript item the dots render next
  // to (see `isLatestAction` below), not just whichever item most recently had an expression.
  // An agent with its own accent keeps that accent for the whole conversation instead: the mood
  // palette is fixed hues (one of which is the default accent), so tinting per turn would pull
  // a themed agent's visualizer off its color on most turns.
  const moodTinted = agentAccentStyle(agentName) === undefined;
  const latestMoodColor = useMemo(() => {
    const latestItem = timeline.find((item) => item.id === latestActionId);
    if (moodTinted && latestItem?.kind === 'speech' && latestItem.expression) {
      return getMoodColor(latestItem.expression);
    }
    return undefined;
  }, [timeline, latestActionId, moodTinted]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const [autoScroll, setAutoScroll] = useState(true);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom < 48);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (autoScroll && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [timeline, showSuggestions, autoScroll]);

  return (
    // `transition={MORPH_SPRING}` matters here, not just cosmetically: every other layout-animated
    // box in this morph (the panel, the visualizer boxes) uses this same spring so they move in
    // lockstep. Left on Motion's default spring, this would settle on its own out-of-sync timing
    // while the panel is still mid-morph — since this component only exists on the conversation
    // side, that desync only ever shows up when entering, not exiting.
    <motion.div layout transition={MORPH_SPRING} className={className}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={cn(
          'scroll-fade relative h-full overflow-y-auto scroll-smooth py-5',
          TRANSCRIPT_INSET,
        )}
      >
        <div className="flex flex-col gap-8 py-2">
          <AnimatePresence>
            {timeline.length === 0 && (
              <div className="absolute inset-0 grid place-content-center">
                <div className="flex flex-col items-center gap-3">
                  <MiniVisualizer state="connecting" />

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { delay: 0 } }}
                    transition={{ duration: 0.2, delay: 0.5 }}
                    className="text-mono-caps text-fg3 text-xxs"
                  >
                    <Shimmer>Connecting</Shimmer>
                  </motion.div>
                </div>
              </div>
            )}

            {timeline.map((item, idx) => {
              const isFirstItem = idx === 0;
              const isLatestAction = item.id === latestActionId;
              const kind = item.kind;
              const isAgent = kind === 'speech' && item.name === 'agent';
              const isUser = kind === 'speech' && item.name !== 'agent';
              const message = kind === 'speech' ? item.text : undefined;
              const toolName = kind === 'tool' ? item.name : undefined;
              const expression = kind === 'speech' && isAgent ? item.expression : undefined;

              return (
                <motion.div
                  key={item.id}
                  // `layout="position"` (not the default `layout={true}`/"both") — this row's own
                  // height already grows smoothly from the content's own chunk-stagger fade-in
                  // (SimulatedTextStream), so there's nothing useful for Motion's scale-based size
                  // FLIP to add here. Left on the default, that redundant self-scale compounds
                  // with MiniVisualizer's independent cross-parent layoutId jump (see
                  // MiniVisualizer.tsx) and produces a visible vertical stretch. Position-only
                  // still smoothly reflows this row when an earlier row's height change pushes it
                  // up/down.
                  layout="position"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    y: { type: 'spring', duration: 0.5, bounce: 0 },
                    opacity: { duration: 0.5 },
                    layout: { type: 'spring', duration: 0.35, bounce: 0 },
                  }}
                >
                  {isUser ? (
                    <UserMessage message={message!} />
                  ) : (
                    <AgentTurn
                      kind={kind}
                      state={state}
                      message={message}
                      toolName={toolName}
                      expression={expression}
                      audioTrack={audioTrack}
                      isFirstItem={isFirstItem}
                      isLatestAction={isLatestAction}
                      latestMoodColor={latestMoodColor}
                    />
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {showSuggestions && (
            <Suggestions suggestions={suggestions} handleSuggestionClick={handleSuggestionClick} />
          )}
        </div>
      </div>
    </motion.div>
  );
}
