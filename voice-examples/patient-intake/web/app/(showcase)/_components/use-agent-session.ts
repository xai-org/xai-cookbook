'use client';

// Agent activity surfaced from the LiveKit Agents session event stream. The
// framework publishes `AgentSessionMessage` protobufs on a byte stream (topic
// `lk.agent.session`); we decode two things from it:
//   - tool calls (`functionToolsExecuted` → each function call's name + args)
//   - the live model config (`sessionUsageUpdated` → STT/LLM/TTS provider+model)
//   - latency metrics (`conversationItemAdded` → the assistant message's
//     `MetricsReport`: STT delay, end-of-turn delay, LLM TTFT, TTS TTFB, e2e)
// No agent-side code is required — this is the same stream the jukebox dev
// playground consumes.
//
// A byte-stream handler is single-per-topic per room, so this hook must be
// called exactly once within a given room (here: once per TranscriptionSection).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { AgentSession } from '@livekit/protocol';
import { ConnectionState, RoomEvent, type ByteStreamHandler } from 'livekit-client';

const TOPIC_SESSION_MESSAGES = 'lk.agent.session';

export interface ToolCall {
  /** `callId` from the agent (stable per invocation), or a synthetic fallback. */
  id: string;
  /** Tool/function name, e.g. `lookup_booking`. */
  name: string;
  /** Raw call arguments, a JSON string (e.g. `{"last_name":"Smith"}`) or empty. */
  args: string;
  /** Arrival time, used to order tool calls against transcript segments. */
  receivedAtMs: number;
}

/** Model config reported by the session, derived from per-model usage. */
export interface AgentSessionConfig {
  sttProvider: string;
  sttModel: string;
  llmProvider: string;
  llmModel: string;
  ttsProvider: string;
  ttsModel: string;
}

const EMPTY_CONFIG: AgentSessionConfig = {
  sttProvider: '',
  sttModel: '',
  llmProvider: '',
  llmModel: '',
  ttsProvider: '',
  ttsModel: '',
};

/** Latency breakdown for the most recent agent turn, in milliseconds. */
export interface AgentSessionMetrics {
  sttLatencyMs: number;
  eotLatencyMs: number;
  llmTtftMs: number;
  ttsTtfbMs: number;
  e2eLatencyMs: number;
}

export interface AgentSessionData {
  toolCalls: ToolCall[];
  /** Latest known model config; fields fill in as each model reports usage. */
  config: AgentSessionConfig;
  /** Latency from the latest agent turn, or null until the first turn completes. */
  metrics: AgentSessionMetrics | null;
}

// MetricsReport delays are reported in seconds; the panel shows milliseconds.
// When a report omits a field, keep the prior value (`fallback`) rather than zeroing it.
function toMs(seconds: number | undefined, fallback = 0): number {
  return seconds === undefined ? fallback : Math.round(seconds * 1000);
}

/** Live tool calls and model config for the agent in the current room. */
export function useAgentSession(): AgentSessionData {
  const room = useRoomContext();
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [config, setConfig] = useState<AgentSessionConfig>(EMPTY_CONFIG);
  const [metrics, setMetrics] = useState<AgentSessionMetrics | null>(null);
  // callIds already recorded — guards against duplicate event delivery.
  const seenRef = useRef<Set<string>>(new Set());
  const synthRef = useRef(0);
  // Latest config, merged across usage events (an event may report only some models).
  const configRef = useRef<AgentSessionConfig>(EMPTY_CONFIG);
  // Latest latency, merged across reports: the user-turn message carries STT +
  // end-of-turn delays, the agent-turn message carries LLM/TTS/e2e — each report
  // omits the other half, so we keep prior values for fields it doesn't include.
  const metricsRef = useRef<AgentSessionMetrics | null>(null);

  const reset = useCallback(() => {
    seenRef.current = new Set();
    synthRef.current = 0;
    configRef.current = EMPTY_CONFIG;
    metricsRef.current = null;
    setToolCalls([]);
    setConfig(EMPTY_CONFIG);
    setMetrics(null);
  }, []);

  useEffect(() => {
    if (!room) {
      return;
    }

    let registered = false;

    const handleStream: ByteStreamHandler = async (reader) => {
      const receivedAtMs = Date.now();
      let message;
      try {
        const chunks = await reader.readAll();
        let total = 0;
        for (const chunk of chunks) {
          total += chunk.byteLength;
        }
        const data = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.byteLength;
        }
        message = AgentSession.AgentSessionMessage.fromBinary(data);
      } catch (error) {
        console.warn('[useAgentSession] failed to parse session message', error);
        return;
      }

      if (message.message.case !== 'event') {
        return;
      }
      const event = message.message.value.event;

      if (event.case === 'functionToolsExecuted') {
        const fresh: ToolCall[] = [];
        for (const call of event.value.functionCalls) {
          const id = call.callId || `tool-${++synthRef.current}`;
          if (seenRef.current.has(id)) {
            continue;
          }
          seenRef.current.add(id);
          fresh.push({ id, name: call.name, args: call.arguments, receivedAtMs });
        }
        if (fresh.length > 0) {
          setToolCalls((prev) => [...prev, ...fresh]);
        }
        return;
      }

      if (event.case === 'sessionUsageUpdated') {
        const next = { ...configRef.current };
        for (const modelUsage of event.value.usage?.modelUsage ?? []) {
          const usage = modelUsage.usage;
          if (usage.case === 'stt') {
            next.sttProvider = usage.value.provider;
            next.sttModel = usage.value.model;
          } else if (usage.case === 'llm') {
            next.llmProvider = usage.value.provider;
            next.llmModel = usage.value.model;
          } else if (usage.case === 'tts') {
            next.ttsProvider = usage.value.provider;
            next.ttsModel = usage.value.model;
          }
        }
        const changed = (Object.keys(next) as (keyof AgentSessionConfig)[]).some(
          (key) => next[key] !== configRef.current[key],
        );
        if (changed) {
          configRef.current = next;
          setConfig(next);
        }
        return;
      }

      if (event.case === 'conversationItemAdded') {
        const item = event.value.item?.item;
        if (item?.case !== 'message' || !item.value.metrics) {
          return;
        }
        const report = item.value.metrics;
        const prev = metricsRef.current;
        // Each report fills only its half; keep prior values for absent fields.
        const next: AgentSessionMetrics = {
          sttLatencyMs: toMs(report.transcriptionDelay, prev?.sttLatencyMs),
          eotLatencyMs: toMs(report.endOfTurnDelay, prev?.eotLatencyMs),
          llmTtftMs: toMs(report.llmNodeTtft, prev?.llmTtftMs),
          ttsTtfbMs: toMs(report.ttsNodeTtfb, prev?.ttsTtfbMs),
          e2eLatencyMs: toMs(report.e2eLatency, prev?.e2eLatencyMs),
        };
        metricsRef.current = next;
        setMetrics(next);
      }
    };

    const register = () => {
      if (registered) {
        return;
      }
      try {
        room.registerByteStreamHandler(TOPIC_SESSION_MESSAGES, handleStream);
        registered = true;
      } catch (error) {
        console.warn('[useAgentSession] failed to register handler', error);
      }
    };

    const unregister = () => {
      if (!registered) {
        return;
      }
      try {
        room.unregisterByteStreamHandler(TOPIC_SESSION_MESSAGES);
      } catch {
        // Handler already torn down — nothing to do.
      }
      registered = false;
    };

    // Each connection starts a fresh agent session — drop stale state.
    const onConnected = () => {
      reset();
      register();
    };
    const onDisconnected = () => {
      unregister();
      reset();
    };

    if (room.state === ConnectionState.Connected) {
      register();
    }
    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      unregister();
    };
  }, [room, reset]);

  return { toolCalls, config, metrics };
}
