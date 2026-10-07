import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type InputItem, NotFoundError, type Tool, SpaceXAI, isFunctionCall, isMessage, toText } from "@xai-official/sdk";
import { type RefundArgs, appendLog, checkRefundPolicy, findOrder, issueRefund, lookupOrder, readLog, refundProblem, sendEmail } from "./shop.ts";

// A run makes a request for every tool call. One that fails before Grok starts answering, because of a
// rate limit or a busy server, is safe to send again, so it's retried, up to five times.
const client = new SpaceXAI({ retryBeforeOutput: true, maxRetries: 5 });

const STATE = "output/state.json";
const AUDIT = "output/audit.log";
// A turn makes one tool call or writes the final note, so a run that needs more is going in circles.
const MAX_TURNS = 12;
const WAITING = Symbol("waiting for approval");

export const SAMPLE = {
  from: "maya.chen@example.com",
  message:
    "Hi, my order A1043 came yesterday and the glass carafe of the pour-over coffee maker was cracked right out of the box. The mugs are fine. Can I get my money back for the coffee maker? Thanks, Maya",
};

const PROMPT = `You're the support agent for Copperleaf Kitchen, an online kitchenware store. Customers email you about refunds.
- Before you decide anything, look up the order and check the refund policy. Only help with an order whose email matches the sender's. If it doesn't match, don't share anything about the order, and ask them to write from the email address on it.
- Refund only what the policy allows, and work out the amount from the policy and the order. If the policy allows a refund, call issue_refund. Every refund waits for a person on the team to approve it, and the call returns once they decide.
- If the policy doesn't allow a refund, don't call issue_refund. Explain why, and offer what the policy allows instead.
- Email the customer with send_customer_message once you know the outcome, and only then: after the refund is issued, after it's rejected, or once you know the policy doesn't allow one. Never promise a refund before it's issued. Keep it short, warm, and specific: the amount, where it goes, and when it shows up. Don't sign it, since the store adds its signature.
- If the team rejects a refund, tell the customer kindly that you can't refund it, explain why using the team's note if there is one, and say what happens next.
- Customers can write back. Answer each reply with send_customer_message. If they push back or get angry, stay calm and kind: acknowledge how they feel, explain the policy plainly, and don't refund or promise anything it doesn't allow, however hard they push. If they ask for a manager, or threaten a chargeback or a bad review, say a person on the team will read the conversation.
- Finish with one sentence for the support team about what you did, and flag anything a person should follow up on.`;

const ORDER_ID = { type: "string", description: "The order number, such as A1043" };
const TOOLS: Tool[] = [
  {
    type: "function",
    name: "lookup_order",
    description: "Look up an order: the customer, the items and their prices, when it was ordered and delivered, the payment method, and any refunds already issued.",
    parameters: { type: "object", properties: { order_id: ORDER_ID }, required: ["order_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "check_refund_policy",
    description: "Get the refund policy and the facts about an order that it depends on: days since delivery, whether that's inside the refund window, final sale items, and how much is left to refund.",
    parameters: { type: "object", properties: { order_id: ORDER_ID }, required: ["order_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "issue_refund",
    description: "Refund money to the order's original payment method. This can't be undone, so a person on the team approves every refund first. Returns the refund once it's issued, or the person's note if they reject it.",
    parameters: {
      type: "object",
      properties: {
        order_id: ORDER_ID,
        amount: { type: "number", description: "The amount to refund, in US dollars" },
        reason: { type: "string", description: "Why the policy allows this refund, in one sentence, for the person approving it" },
      },
      required: ["order_id", "amount", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "send_customer_message",
    description: "Email the customer who wrote in. Write only the message, without a sign-off: the store adds its signature.",
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false },
  },
];

// A function call from the run's last response. `output` is saved as soon as the call has run, so a
// run that's picked up again sends the saved output instead of running the call a second time.
export type Call = { call_id: string; name: string; arguments: string; output?: unknown };
export type Step = { at: string } & (
  // The customer's first email, or a reply to the agent's, which Grok writes when it plays the customer.
  | { kind: "request"; from: string; message: string; reply?: boolean; simulated?: boolean }
  | { kind: "turn"; pid: number; response_id: string; previous_response_id: string | null; reasoning: string; seconds: number }
  | { kind: "call"; call_id: string; name: string; arguments: Record<string, unknown> }
  | { kind: "result"; call_id: string; name: string; output: unknown }
  | { kind: "resume"; pid: number; response_id: string; restarted: boolean }
  | { kind: "note"; text: string }
  | { kind: "error"; message: string }
);
export type Run = {
  id: string;
  from: string;
  message: string;
  // "customer" is while Grok, playing the customer, writes a reply.
  status: "working" | "waiting" | "customer" | "stopped" | "done" | "failed";
  // The customer Grok plays, if it plays one, and how many replies the customer has sent. A reply
  // waits in `reply` until the next turn sends it.
  persona?: string;
  replies?: number;
  reply?: string;
  // The last response the run stored, where it continues from, and the calls in it that need outputs.
  response_id: string | null;
  calls: Call[];
  steps: Step[];
  requests: number;
  cost: number;
  // The process that last worked on the run, which shows when it was picked up after a restart.
  pid: number;
  created_at: string;
};
export type Approval = {
  // The issue_refund call's ID, which is also the refund's idempotency key.
  id: string;
  run: string;
  response_id: string;
  call_id: string;
  arguments: RefundArgs;
  order: { customer: string; payment: string; total: number };
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  decided_by?: string;
  decided_at?: string;
  note?: string;
  refund?: string;
};
export type AuditEntry = {
  at: string;
  action: "requested" | "approved" | "rejected" | "ignored" | "refunded" | "replayed";
  by: string;
  approval: string;
  run: string;
  order: string;
  amount: number;
  pid: number;
  refund?: string;
  note?: string;
};

export type AgentEvents = {
  run?: (run: Run) => void;
  step?: (run: Run, step: Step) => void;
  delta?: (run: Run, kind: "reasoning" | "text", text: string) => void;
  approval?: (approval: Approval) => void;
  audit?: (entry: AuditEntry) => void;
};

type State = { runs: Record<string, Run>; approvals: Record<string, Approval> };
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { runs: {}, approvals: {} };

export function snapshot() {
  return { runs: Object.values(state.runs), approvals: Object.values(state.approvals), audit: readLog<AuditEntry>(AUDIT) };
}

export function getRun(id: string): Run | undefined {
  return state.runs[id];
}

export function getApproval(id: string): Approval | undefined {
  return state.approvals[id];
}

export function pendingApprovals(): Approval[] {
  return Object.values(state.approvals).filter((approval) => approval.status === "pending");
}

// Runs that were working, or waiting on a reply from the customer Grok plays, when the last process
// stopped, for example because it crashed.
export function interruptedRuns(): Run[] {
  return Object.values(state.runs).filter((run) => run.status === "working" || run.status === "customer");
}

export function createRun(from: string, message: string, on: AgentEvents = {}, persona?: string): Run {
  const run: Run = {
    id: `run_${randomUUID().slice(0, 8)}`,
    from,
    message,
    persona,
    status: "working",
    response_id: null,
    calls: [],
    steps: [],
    requests: 0,
    cost: 0,
    pid: process.pid,
    created_at: now(),
  };
  state.runs[run.id] = run;
  addStep(run, { kind: "request", at: now(), from, message }, on);
  return run;
}

// Works on the run until it finishes or has to wait for a person, starting from the last response it
// stored. The same function starts a new run, picks one up after a refund is approved or rejected, and
// picks up one that was stopped or cut off by a crash.
export async function advance(id: string, on: AgentEvents = {}, signal?: AbortSignal): Promise<Run> {
  const run = state.runs[id];
  // A run that already answered everything, with no calls or reply waiting, has nothing to send.
  if (run.response_id && !run.calls.length && !run.reply) return setStatus(run, "done", on);
  if (run.response_id) {
    addStep(run, { kind: "resume", at: now(), pid: process.pid, response_id: run.response_id, restarted: run.pid !== process.pid }, on);
  }
  run.pid = process.pid;
  setStatus(run, "working", on);
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const outputs: InputItem[] = [];
      for (const call of run.calls) {
        if (call.output === undefined) {
          const output = runTool(run, call, on);
          if (output === WAITING) return setStatus(run, "waiting", on);
          call.output = output;
          addStep(run, { kind: "result", at: now(), call_id: call.call_id, name: call.name, output }, on);
        }
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(call.output) });
      }
      // A reply from the customer goes after the outputs, as a new message in the same conversation.
      if (run.reply) outputs.push({ role: "user", content: `From: ${run.from}\n\n${run.reply}` });
      await respond(run, outputs, on, signal);
      if (run.reply) {
        run.reply = undefined;
        save();
      }
      if (!run.calls.length) return setStatus(run, "done", on);
    }
    throw new Error(`The agent didn't finish in ${MAX_TURNS} turns.`);
  } catch (error) {
    if (signal?.aborted) return setStatus(run, "stopped", on);
    const expired = error instanceof NotFoundError && run.response_id;
    const message = expired ? `Stored response ${run.response_id} is gone. They're kept for 30 days, so this run can't continue.` : String(error instanceof Error ? error.message : error);
    addStep(run, { kind: "error", at: now(), message }, on);
    return setStatus(run, "failed", on);
  }
}

// A reply from the customer to the agent's last email. The next turn sends it with previous_response_id
// set to the run's last stored response, so the agent has the whole conversation without it being
// sent again. When Grok wrote the reply, playing the customer, its request counts toward the run.
export function addReply(id: string, message: string, on: AgentEvents = {}, simulated?: { cost: number }): Run {
  const run = state.runs[id];
  run.reply = message;
  run.replies = (run.replies ?? 0) + 1;
  if (simulated) {
    run.requests++;
    run.cost += simulated.cost;
  }
  addStep(run, { kind: "request", at: now(), from: run.from, message, reply: true, simulated: Boolean(simulated) }, on);
  return run;
}

export function markRun(id: string, status: Run["status"], on: AgentEvents = {}): Run {
  return setStatus(state.runs[id], status, on);
}

// Records a person's decision on a refund. The status changes in memory and on disk before anything is
// awaited, so a second click, even one that arrives at the same moment, finds it already decided.
export function decide(
  id: string,
  decision: "approved" | "rejected",
  by: string,
  note: string,
  on: AgentEvents = {},
): { approval: Approval; changed: boolean } {
  const approval = state.approvals[id];
  if (approval.status !== "pending") {
    audit(approval, "ignored", by, { note: `already ${approval.status} by ${approval.decided_by}` }, on);
    return { approval, changed: false };
  }
  Object.assign(approval, { status: decision, decided_by: by, decided_at: now(), note: note || undefined });
  save();
  audit(approval, decision, by, { note: note || undefined }, on);
  on.approval?.(approval);
  return { approval, changed: true };
}

// One turn: the first one sends the conversation, and every later one sends only the outputs of the
// last turn's calls, continuing from the stored response that made them.
async function respond(run: Run, outputs: InputItem[], on: AgentEvents, signal?: AbortSignal): Promise<void> {
  const started = Date.now();
  let reasoning = "";
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      // Each turn picks a tool or writes a short email, which low effort handles in seconds.
      reasoning: { effort: "low" },
      input: run.response_id ? outputs : [{ role: "system", content: PROMPT }, { role: "user", content: `From: ${run.from}\n\n${run.message}` }],
      tools: TOOLS,
      // One call per turn, so a turn that stops for approval leaves no other call waiting.
      parallel_tool_calls: false,
      // The SDK doesn't store responses unless asked. Stored ones are kept for 30 days, which is how
      // long a refund can wait for approval and still continue from where it stopped.
      store: true,
      previous_response_id: run.response_id,
      // Sends every turn of the run to the same server, which already has the earlier turns cached.
      prompt_cache_key: run.id,
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => {
      reasoning += text;
      on.delta?.(run, "reasoning", text);
    })
    .on("text", (text) => on.delta?.(run, "text", text))
    .done();

  const previous = run.response_id;
  run.response_id = response.id;
  run.calls = response.output.filter(isFunctionCall).map(({ call_id, name, arguments: args }) => ({ call_id, name, arguments: args }));
  run.requests++;
  run.cost += response.usage.cost_usd ?? 0;
  addStep(run, { kind: "turn", at: now(), pid: process.pid, response_id: response.id, previous_response_id: previous, reasoning, seconds: (Date.now() - started) / 1000 }, on);
  for (const item of response.output) {
    if (isFunctionCall(item)) addStep(run, { kind: "call", at: now(), call_id: item.call_id, name: item.name, arguments: parse(item.arguments) }, on);
    const text = isMessage(item) ? toText([item]).trim() : "";
    if (text) addStep(run, { kind: "note", at: now(), text }, on);
  }
}

// Runs a tool the model called and returns what the model gets back, or WAITING for a refund that
// nobody has decided on yet.
function runTool(run: Run, call: Call, on: AgentEvents): unknown {
  const args = parse(call.arguments);
  if (call.name === "lookup_order") return lookupOrder(String(args.order_id));
  if (call.name === "check_refund_policy") return checkRefundPolicy(String(args.order_id));
  if (call.name === "issue_refund") return refund(run, call, args as RefundArgs, on);
  if (call.name === "send_customer_message") {
    // It can only write back to whoever sent the request, whatever the model asks for, and the store's
    // signature goes on its own line, even if the model signed the message anyway.
    const body = String(args.message).replace(/\s*Copperleaf Kitchen support\.?\s*$/i, "").trim();
    const email = sendEmail(call.call_id, run.from, `${body}\n\nCopperleaf Kitchen support`);
    return { sent: true, to: email.to, id: email.id, message: email.message };
  }
  return { error: `There's no tool called ${call.name}.` };
}

// The first time the call comes up, it becomes a pending approval, saved with the response and call it
// came from, and the run stops there. Once someone decides, the run continues from that same response
// and comes back here with the same call.
function refund(run: Run, call: Call, args: RefundArgs, on: AgentEvents): unknown {
  let approval = state.approvals[call.call_id];
  if (!approval) {
    const problem = refundProblem(args);
    if (problem) return { error: problem };
    const order = findOrder(args.order_id);
    if (!order) return { error: `There's no order ${args.order_id}.` };
    approval = {
      id: call.call_id,
      run: run.id,
      response_id: run.response_id as string,
      call_id: call.call_id,
      arguments: { order_id: order.id, amount: args.amount, reason: String(args.reason) },
      order: { customer: order.customer.name, payment: order.payment, total: order.total },
      status: "pending",
      requested_at: now(),
    };
    state.approvals[approval.id] = approval;
    save();
    audit(approval, "requested", "agent", {}, on);
    on.approval?.(approval);
  }
  if (approval.status === "pending") return WAITING;
  if (approval.status === "rejected") return { status: "rejected", rejected_by: approval.decided_by, note: approval.note ?? "" };

  // If a crash cut the run off after the refund went through but before its output was saved, this
  // sends the same key again and gets back the refund that was already made.
  const result = issueRefund(approval.id, approval.arguments);
  if ("error" in result) return { error: result.error };
  // To try that out, CRASH_AFTER_REFUND=1 ends the process right here, after a new refund.
  if (!result.replayed && process.env.CRASH_AFTER_REFUND) process.exit(1);
  approval.refund = result.refund.id;
  save();
  audit(approval, result.replayed ? "replayed" : "refunded", "agent", { refund: result.refund.id }, on);
  on.approval?.(approval);
  return { status: "refunded", refund_id: result.refund.id, amount: result.refund.amount, payment: result.refund.payment, approved_by: approval.decided_by };
}

function audit(approval: Approval, action: AuditEntry["action"], by: string, extra: Partial<AuditEntry>, on: AgentEvents): void {
  const entry: AuditEntry = {
    at: now(),
    action,
    by,
    approval: approval.id,
    run: approval.run,
    order: approval.arguments.order_id,
    amount: approval.arguments.amount,
    pid: process.pid,
    ...extra,
  };
  appendLog(AUDIT, entry);
  on.audit?.(entry);
}

function addStep(run: Run, step: Step, on: AgentEvents): void {
  run.steps.push(step);
  save();
  on.step?.(run, step);
}

function setStatus(run: Run, status: Run["status"], on: AgentEvents): Run {
  run.status = status;
  save();
  on.run?.(run);
  return run;
}

// Written to a temporary file and renamed over the old one, so a crash can't leave the file half
// written, and synchronously, so two saves can't interleave.
function save(): void {
  mkdirSync("output", { recursive: true });
  writeFileSync(`${STATE}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${STATE}.tmp`, STATE);
}

function parse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function now(): string {
  return new Date().toISOString();
}
