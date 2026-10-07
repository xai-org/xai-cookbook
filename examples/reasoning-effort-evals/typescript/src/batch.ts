import { setTimeout as sleep } from "node:timers/promises";
import type { BatchResult, CreateParams, SpaceXAI } from "@xai-official/sdk";

const POLL_MS = 10_000;

export type BatchEvents = {
  sent?: (batchId: string) => void;
  result?: (result: BatchResult) => void;
  progress?: (batchId: string, done: number, total: number) => void;
};

// Sends every request in one batch, keyed by an id that's unique within it, and hands over each result as
// soon as it's ready, since results arrive one by one and in any order. Returns the ids that got a result.
export async function sendBatch(
  client: SpaceXAI,
  name: string,
  requests: Map<string, CreateParams>,
  on: BatchEvents = {},
  signal?: AbortSignal,
): Promise<Set<string>> {
  const batch = await client.batches.create({ name }, { signal });
  try {
    await client.batches.requests.add(
      batch.batch_id,
      { batch_requests: [...requests].map(([id, body]) => ({ batch_request_id: id, batch_request: { responses: body } })) },
      { signal },
    );
    on.sent?.(batch.batch_id);
    const seen = new Set<string>();
    while (true) {
      await sleep(POLL_MS, undefined, { signal });
      const { state } = await client.batches.get(batch.batch_id, { signal });
      for await (const result of client.batches.results(batch.batch_id, {}, { signal })) {
        if (!requests.has(result.batch_request_id) || seen.has(result.batch_request_id)) continue;
        seen.add(result.batch_request_id);
        on.result?.(result);
      }
      on.progress?.(batch.batch_id, seen.size, requests.size);
      if (state.num_pending === 0) return seen;
    }
  } finally {
    // Stopping cancels the batch, so the requests that haven't run yet aren't billed.
    if (signal?.aborted) await client.batches.cancel(batch.batch_id).catch(() => {});
  }
}
