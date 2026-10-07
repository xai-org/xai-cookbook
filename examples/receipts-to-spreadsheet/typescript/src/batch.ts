import { setTimeout as sleep } from "node:timers/promises";
import { type BatchResult, SpaceXAI } from "@xai-official/sdk";
import { type Read, type ReceiptEvents, type Row, checkReceipt, compareReads, prepare, readRequest } from "./receipts.ts";

const client = new SpaceXAI();

// grok-4.7 doesn't take batch requests, so batch mode reads with grok-4.3, which does.
export const BATCH_MODEL = "grok-4.3";
const POLL_MS = 5000;

export type BatchEvents = Pick<ReceiptEvents, "row" | "error"> & {
  created?: (id: string) => void;
  progress?: (done: number, total: number) => void;
};

// Sends both reads of every receipt as one batch, then checks on it every few seconds and reports each
// receipt as soon as both its reads are back. Reads that fail the checks aren't retried, because a second
// round would wait in the queue again. If the signal aborts, the batch is cancelled so the reads still
// waiting don't run.
export async function readInBatch(
  files: Array<{ name: string; file: Blob }>,
  on: BatchEvents = {},
  signal?: AbortSignal,
): Promise<Array<Row | undefined>> {
  const materials = await Promise.all(files.map((file) => prepare(file.file, file.name, signal)));
  const batch = await client.batches.create({ name: "receipts-to-spreadsheet" }, { signal });
  on.created?.(batch.batch_id);
  try {
    await client.batches.requests.add(
      batch.batch_id,
      {
        batch_requests: materials.flatMap((material, index) =>
          [1, 2].map((read) => ({
            batch_request_id: `${index}-${read}`,
            batch_request: { responses: readRequest(BATCH_MODEL, material) },
          })),
        ),
      },
      { signal },
    );

    const reads = new Map<string, Read | Error>();
    const rows = new Map<number, Row | undefined>();
    for (;;) {
      const { state } = await client.batches.get(batch.batch_id, { signal });
      on.progress?.(state.num_requests - state.num_pending, state.num_requests);
      // Results are ready as soon as each request finishes, so receipts show up before the batch is done.
      if (reads.size < state.num_success + state.num_error) {
        for await (const result of client.batches.results(batch.batch_id, undefined, { signal })) {
          if (!reads.has(result.batch_request_id)) reads.set(result.batch_request_id, toRead(result));
        }
        for (let index = 0; index < files.length; index++) {
          const pair = [reads.get(`${index}-1`), reads.get(`${index}-2`)];
          if (rows.has(index) || !pair[0] || !pair[1]) continue;
          const failed = pair.find((read) => read instanceof Error);
          const row = failed ? undefined : compareReads(pair[0] as Read, pair[1] as Read);
          rows.set(index, row);
          if (row) on.row?.(index, row);
          else on.error?.(index, failed as Error);
        }
      }
      if (state.num_requests > 0 && state.num_pending === 0) return files.map((_, index) => rows.get(index));
      await sleep(POLL_MS, undefined, { signal });
    }
  } catch (error) {
    if (signal?.aborted) await client.batches.cancel(batch.batch_id).catch(() => {});
    throw error;
  }
}

// Batch results come back in the Chat Completions format, with the receipt's JSON as the message content.
// They don't go through toJson(), so the same Zod schema checks them with checkReceipt().
function toRead(result: BatchResult): Read | Error {
  const outcome = result.batch_result;
  if ("error" in outcome) return new Error(outcome.error);
  const completion = typeof outcome.response === "object" && "chat_get_completion" in outcome.response
    ? outcome.response.chat_get_completion
    : undefined;
  try {
    const receipt = JSON.parse(completion?.choices[0]?.message.content ?? "");
    const cost = (completion?.usage?.cost_in_usd_ticks ?? 0) / 1e10;
    return { receipt, problems: checkReceipt(receipt), attempts: 1, cost };
  } catch {
    return new Error("The batch result didn't have the receipt's JSON");
  }
}
