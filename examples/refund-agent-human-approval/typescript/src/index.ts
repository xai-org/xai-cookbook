import { parseArgs, styleText } from "node:util";
import { type AgentEvents, type Approval, type Run, type Step, SAMPLE, addReply, createRun, decide, getApproval, getRun, pendingApprovals, snapshot } from "./agent.ts";
import { PERSONAS, converse } from "./customer.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: "string", default: SAMPLE.from },
    as: { type: "string", default: "Dana Kim" },
    note: { type: "string", default: "" },
  },
});

// Ctrl+C stops the run where it is, and `npm start -- resume` continues it from its last stored response.
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());

let thinking = false;
const events: AgentEvents = {
  step: (_, step) => print(step),
  delta: (_, kind, text) => {
    if (kind !== "reasoning") return;
    if (!thinking) process.stdout.write(styleText("dim", "  Thinking: "));
    thinking = true;
    process.stdout.write(styleText("dim", text.replace(/\s+/g, " ")));
  },
  audit: (entry) => {
    if (entry.action !== "replayed") return;
    console.log(styleText("yellow", `  The refund went through before the last process stopped, so the payment provider returned ${entry.refund} instead of making a second one.`));
  },
};

const [command, id] = positionals;
let run: Run;
if (command === "approve" || command === "reject") run = await decideAndResume(command, id);
else if (command === "resume") run = await resume(id);
else if (command === "reply") run = await reply(positionals.slice(1).join(" "));
else if (command === "angry") run = await converse(createRun(PERSONAS.angry.from, PERSONAS.angry.message, events, "angry").id, events, abort.signal);
else run = await converse(createRun(values.from, positionals.join(" ") || SAMPLE.message, events).id, events, abort.signal);
report(run);

// The customer writes back to the last finished run, which continues from its last stored response.
async function reply(message: string): Promise<Run> {
  if (!message) return exit('Write the reply: npm start -- reply "Your reply"');
  const run = snapshot().runs.findLast((run) => run.status === "done");
  if (!run) return exit("There's no finished run to reply to.");
  addReply(run.id, message, events);
  return converse(run.id, events, abort.signal);
}

async function decideAndResume(command: "approve" | "reject", id?: string): Promise<Run> {
  const approval = id ? getApproval(id) : onlyPending();
  if (!approval) return exit(`There's no approval ${id}.`);
  const { changed } = decide(approval.id, command === "approve" ? "approved" : "rejected", values.as, values.note, events);
  const what = `refunding $${approval.arguments.amount.toFixed(2)} for order ${approval.arguments.order_id}`;
  console.log(changed ? `${values.as} ${approval.status} ${what}.` : `${approval.decided_by} already ${approval.status} ${what}, so nothing changed.`);
  const run = getRun(approval.run) as Run;
  // Already decided but not done means the last process stopped partway, so this finishes the run.
  return run.status === "done" ? run : converse(run.id, events, abort.signal);
}

async function resume(id?: string): Promise<Run> {
  const run = id ? getRun(id) : snapshot().runs.findLast((run) => ["working", "customer", "stopped", "failed"].includes(run.status));
  if (!run) return exit(id ? `There's no run ${id}.` : "There's no run to resume.");
  if (run.status === "waiting") return exit(`${run.id} is waiting for approval. Approve it with: npm start -- approve`);
  if (run.status === "done") return exit(`${run.id} is already done.`);
  return converse(run.id, events, abort.signal);
}

function onlyPending(): Approval | undefined {
  const pending = pendingApprovals();
  if (pending.length > 1) {
    for (const approval of pending) console.log(`  ${approval.id}  $${approval.arguments.amount.toFixed(2)} for ${approval.arguments.order_id}`);
    return exit("Several refunds are waiting. Pass the one to decide: npm start -- approve <id>");
  }
  return pending[0] ?? exit("Nothing is waiting for approval.");
}

function print(step: Step): void {
  if (thinking) process.stdout.write("\n");
  thinking = false;
  if (step.kind === "request") {
    const label = step.reply ? `\nReply from ${step.from}${step.simulated ? ", written by Grok playing the customer" : ""}:` : `From ${step.from}:`;
    console.log(`${styleText("bold", label)} ${step.message}\n`);
  }
  if (step.kind === "resume") {
    const where = step.restarted ? ` in process ${step.pid}, a different process from the one that stopped it` : "";
    console.log(styleText("bold", `\nContinuing from stored response ${step.response_id}${where}`));
  }
  if (step.kind === "turn") console.log(styleText("dim", `  Stored response ${step.response_id} (${step.seconds.toFixed(1)} s)`));
  if (step.kind === "call") {
    const { message, ...args } = step.arguments;
    console.log(`${styleText("cyan", "→")} ${step.name} ${styleText("dim", message ? "" : JSON.stringify(args))}`);
    if (message) console.log(styleText("dim", String(message).replace(/^/gm, "    ")));
  }
  if (step.kind === "result") console.log(`  ${describe(step.name, step.output as Record<string, unknown>)}`);
  if (step.kind === "note") console.log(`\n${styleText("bold", step.text)}`);
  if (step.kind === "error") console.log(styleText("red", step.message));
}

function describe(tool: string, output: Record<string, unknown>): string {
  if (output.error) return styleText("red", String(output.error));
  if (tool === "lookup_order") {
    const { customer, items, total, payment } = output as { customer: { name: string }; items: unknown[]; total: number; payment: string };
    return `${customer.name}, ${plural(items.length, "item")}, $${total.toFixed(2)} paid with ${payment}`;
  }
  if (tool === "check_refund_policy") {
    const { days_since_delivery, within_refund_window, refundable } = output as { days_since_delivery: number; within_refund_window: boolean; refundable: number };
    return `Delivered ${plural(days_since_delivery, "day")} ago, ${within_refund_window ? "inside" : "outside"} the refund window, $${refundable.toFixed(2)} left to refund`;
  }
  if (tool === "issue_refund" && output.status === "rejected") return `Rejected by ${output.rejected_by}${output.note ? `: ${output.note}` : ""}`;
  if (tool === "issue_refund") return styleText("green", `Refund ${output.refund_id} issued: $${Number(output.amount).toFixed(2)} to ${output.payment}, approved by ${output.approved_by}`);
  if (tool === "send_customer_message") return `Emailed ${output.to}, which only writes it to output/outbox.log`;
  return JSON.stringify(output);
}

function report(run: Run): void {
  const spent = `${run.requests} requests, $${run.cost.toFixed(3)}`;
  if (run.status === "waiting") {
    const approval = pendingApprovals().find((approval) => approval.run === run.id) as Approval;
    console.log(`\n${styleText("bold", "Waiting for approval.")} Saved to output/state.json:`);
    console.log(styleText("dim", `  response_id  ${approval.response_id}\n  call_id      ${approval.call_id}\n  arguments    ${JSON.stringify(approval.arguments)}`));
    console.log(`Approve it:  npm start -- approve\nReject it:   npm start -- reject --note "Why not"`);
    console.log(styleText("dim", `So far: ${spent}`));
  }
  if (run.status === "done") console.log(styleText("dim", `\nDone in ${spent}. The approvals are in output/audit.log.`));
  if (run.status === "stopped") console.log(`\nStopped after ${spent}. Continue it with: npm start -- resume ${run.id}`);
  if (run.status === "failed") console.log(`\nThe run failed after ${spent}. Try again with: npm start -- resume ${run.id}`);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function exit(message: string): never {
  console.log(message);
  process.exit(1);
}
