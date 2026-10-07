import { SpaceXAI } from "@xai-official/sdk";
import { type AgentEvents, type Run, addReply, advance, getRun, markRun } from "./agent.ts";

const client = new SpaceXAI({ retryBeforeOutput: true, maxRetries: 5 });
// A customer Grok plays writes at most this many replies, so a run can't argue forever.
const MAX_REPLIES = 3;

// Customers Grok can play, to see how the agent holds up. Each has a first email and a brief that
// Grok follows for every reply after it.
export const PERSONAS: Record<string, { from: string; message: string; brief: string }> = {
  angry: {
    from: "priya.nair@example.com",
    message:
      "I want ALL of my money back for order A1066, today. The gift card was a birthday present and my sister doesn't even cook, and I don't want the skillet either. $94.95 for nothing. This is the worst store I've ever ordered from. Priya",
    brief: `You're playing Priya Nair, a customer of Copperleaf Kitchen, to test its support agent. Six days ago you got order A1066: a $50 gift card and a $39 cast iron skillet, $94.95 with shipping. Your sister doesn't want the gift card, you don't want the skillet, and you want every cent back. You're furious, and you don't care what the policy says.

Write each reply as a short, heated email of two to four sentences, in plain text, signed "Priya". Push back on anything less than all $94.95: call the policy ridiculous, say you've ordered from them for years, and threaten to dispute the charge with your bank and leave a one-star review. If they hold firm twice, demand a manager. Don't make up anything new about the order. Once support has answered three of your replies, or given you everything you asked for, write only DONE.`,
  },
};

// Works on the run, and if Grok plays its customer, answers each email the agent sends as that
// customer and works on the reply, until the customer is done or has written MAX_REPLIES replies.
export async function converse(id: string, on: AgentEvents = {}, signal?: AbortSignal): Promise<Run> {
  let run = getRun(id) as Run;
  // A run that was waiting on the customer when its process stopped picks up with their reply.
  if (run.status !== "customer") run = await advance(id, on, signal);
  const persona = run.persona ? PERSONAS[run.persona] : undefined;
  while (persona && (run.status === "done" || run.status === "customer") && (run.replies ?? 0) < MAX_REPLIES) {
    markRun(id, "customer", on);
    const reply = await customerReply(run, persona.brief, signal).catch(() => undefined);
    if (!reply) break;
    addReply(id, reply.text, on, { cost: reply.cost });
    run = await advance(id, on, signal);
  }
  // The customer is done, or Stop ended the conversation while Grok was writing as them.
  return run.status === "customer" ? markRun(id, "done", on) : run;
}

// Grok, playing the customer, reads the emails so far and writes the next one, or nothing when the
// customer is done. It's a separate request with no tools, which doesn't see the agent's reasoning.
async function customerReply(run: Run, brief: string, signal?: AbortSignal): Promise<{ text: string; cost: number } | undefined> {
  const emails = run.steps.flatMap((step) => {
    if (step.kind === "request") return [`You wrote:\n${step.message}`];
    const sent = step.kind === "result" && step.name === "send_customer_message" ? (step.output as { message?: string }).message : undefined;
    return sent ? [`Copperleaf Kitchen support wrote:\n${sent}`] : [];
  });
  const response = await client.responses.create(
    {
      model: "grok-4.7",
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: brief },
        { role: "user", content: `${emails.join("\n\n")}\n\nWrite your next email.` },
      ],
    },
    { signal },
  );
  const text = response.toText().trim();
  return !text || /^DONE\b/.test(text) ? undefined : { text, cost: response.usage.cost_usd ?? 0 };
}
