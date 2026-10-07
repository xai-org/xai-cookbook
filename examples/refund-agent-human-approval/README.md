---
title: Refund Agent with Human Approval
description: Build a support agent that stops before issuing a refund, waits for a person to approve it, and resumes the same run from a stored response, even after a server restart.
type: guide
level: advanced
languages: [typescript]
capabilities: [function-calling, streaming, reasoning]
models: [grok-4.7]
env: [XAI_API_KEY]
authors: [Eric Zakariasson]
date: 2026-10-05
---

# Refund Agent with Human Approval

A customer emails about a refund. The agent looks up the order and the refund policy, works out what the policy allows, and proposes a refund. A refund can't be undone, so the agent stops there and the refund waits in a queue for a person to approve it. Once someone does, the agent picks up the same run where it stopped, issues the refund once, and emails the customer, even if the server restarted in between. An audit log records who approved what.

## What you'll learn

- Stop an agent before a function call that can't be undone, and save what it needs to continue: the ID of the response it stored, the ID of the call, and the call's arguments
- Resume the run later with `previous_response_id` and the call's output, without sending the conversation again, because `store: true` keeps it on SpaceXAI's servers for 30 days
- Use the call ID as an idempotency key, so an approved refund runs once even if Approve is clicked twice or the server crashes partway
- Keep an audit log of who asked for, approved, and rejected each refund
- Continue a finished run when the customer writes back, from the same stored response, and test the agent against an angry customer that Grok plays
- Stream the agent's reasoning and tool calls from a Node server to a web page with server-sent events, and pick up interrupted runs when the server starts again

## Run it

You need Node.js 22.13 or later. Put your API key in `.env` at the root of the repo, or export `XAI_API_KEY`.

```bash
cd examples/refund-agent-human-approval/typescript
npm install
npm run web
```

Open http://localhost:3000. The page works like a support helpdesk, with the inbox on the left, the ticket in the middle, and the approval queue and audit log on the right. Walk through it like this:

1. Click **Cracked on arrival**. Maya writes that her pour-over coffee maker arrived cracked, but the mugs in the same order are fine. The ticket shows each step as the agent works: its reasoning, the order it looked up, what the policy says about it, and a proposed refund of $48.00, for the coffee maker and not the mugs. The run stops there, and the refund shows up under **Waiting for approval**.
2. Stop the server with Ctrl+C, and start it again with `npm run web`. The header shows the server going offline and coming back with a new process ID. The refund is still waiting, loaded from `output/state.json`.
3. Click **Approve**. The new process continues the run from the response the old one stored, and the ticket marks the spot with **Server restarted**. The agent issues the refund, emails Maya, and leaves a note for the team. In the audit log, the request comes from the old process and the approval and the refund from the new one.
4. Try the other cases. **Reject** asks for a note, and the agent uses it to explain the decision to the customer. **Past 30 days** is a request the policy doesn't allow, so the agent says no without asking anyone. **Stop** cancels a run partway, and **Resume** continues it from the last response it stored.
5. Click **Angry customer**. Priya wants all $94.95 back for order A1066, including a gift card that's final sale. The agent proposes refunding only the skillet, $31.50 after the return fee, and once someone approves, Grok plays Priya and writes back: she won't accept it, threatens a chargeback and a one-star review, and asks for a manager. The agent stays calm, keeps to the policy, and flags the threats in its note for the team. Each reply from the customer is marked as written by Grok, and after three, or sooner if she gives up, the conversation ends. Under any resolved ticket, **Reply as the customer** lets you push back yourself.

To try the crash path, start the server with `CRASH_AFTER_REFUND=1 npm run web` and approve a refund. The process exits right after the refund goes through, before the run saves that it did. Start the server again without the variable. It picks up the run by itself, the payment provider hands back the refund it already made instead of making a second one, and the audit log records the reuse.

The terminal version runs the same flow, and every command is a new process:

```bash
npm start                               # sends Maya's email and stops at the approval
npm start -- approve --as "Dana Kim"    # approves it in a new process and finishes the run
npm start -- approve                    # nothing left to approve
```

`npm start -- reject --note "Why not"` rejects the refund instead, and `npm start -- "Your email" --from you@example.com` sends your own request. `npm start -- angry` starts the angry customer, and `npm start -- reply "Your reply"` writes back to the last finished run as the customer. Ctrl+C stops a run, and `npm start -- resume` continues the last one that was stopped, failed, or cut off by a crash, such as `CRASH_AFTER_REFUND=1 npm start -- approve`, without a second refund. The terminal and the web app share `output/`, so use one at a time.

Maya's request takes five requests to `grok-4.7`, three before the approval and two after. Most of them took one to four seconds when we ran it, so a run spends 10 to 15 seconds waiting on Grok, plus however long the approval takes. When the API was busy, a single request sometimes took 20 seconds. A run cost about a cent, and both versions show the cost of each run.

## How it works

The agent is in `src/agent.ts`. The store it works for is in `src/shop.ts`, with orders from `orders.json`, the policy from `refund-policy.md`, and two stand-ins for outside systems: a payment provider that writes refunds to `output/refunds.log`, and an email service that writes to `output/outbox.log` instead of sending anything.

1. The model gets four function tools: `lookup_order`, `check_refund_policy`, `issue_refund`, and `send_customer_message`. The policy tool returns the policy along with the facts it turns on, such as the days since delivery and how much is left to refund, so the model doesn't count days or add up earlier refunds. `send_customer_message` can only write back to whoever sent the request, and the store adds its signature on its own line, so every email ends the same way.
2. `advance()` runs the agent one turn at a time. Each turn streams a `client.responses.create()` request with `store: true`, so the API keeps the response for 30 days. The SDK doesn't store responses unless you ask. The first turn sends the system prompt and the customer's email. Every later turn sends only the outputs of the last turn's function calls, with `previous_response_id` set to the response that made the calls, and the API supplies the rest of the conversation. The API rejects `instructions` together with `previous_response_id`, so the prompt goes in the first turn's input. `parallel_tool_calls: false` keeps each turn to one call, so a turn that stops for approval leaves no other call waiting. Every turn of a run uses the same `prompt_cache_key`, which sends them to the same server, where the earlier turns are already cached.
3. When the model calls `issue_refund`, `refund()` doesn't run it. It checks the arguments against the order, saves a pending approval to `output/state.json`, and the run stops. Nothing runs while the refund waits, so the server can restart, or the approval can sit for days. The approval holds everything the run needs to continue:

   ```json
   {
     "id": "call-358bffbd-f436-43ec-8031-6a57f0ca0d93-2",
     "run": "run_ce2290f3",
     "response_id": "0ba8f3c0-ea96-9805-8bbb-01da7e9a74f7",
     "call_id": "call-358bffbd-f436-43ec-8031-6a57f0ca0d93-2",
     "arguments": { "order_id": "A1043", "amount": 48, "reason": "Glass pour-over coffee maker arrived cracked; full item price refunded within 30 days, no return required." },
     "status": "pending"
   }
   ```

4. `decide()` records the decision and who made it, in the state file and the audit log, before anything is awaited. A second click finds the refund already decided, so the server answers 409 and the audit log notes the attempt. Then `advance()` comes back to the same call. For an approval it issues the refund, and for a rejection it returns the person's note. It sends that as the call's output, with `previous_response_id` set to the saved response, and the model carries on with the order, the policy, and its own reasoning still in context.
5. Every call's output is saved as soon as the call runs, and a resumed run sends the saved output instead of running the call again. That leaves one gap: a crash after the refund goes through but before its output is saved. `issueRefund()` closes it by taking the call ID as an idempotency key, the way payment providers take an `Idempotency-Key` header. The first request with a key makes the refund, and any later one gets that refund back. The outbox does the same for emails.
6. `output/audit.log` gets a line for each refund the agent asks for, each approval and rejection, each refund issued or reused, and each decision that came too late, with who, when, and which process.
7. A run that was in the middle of a turn when its process died is still marked as working in the state file, and `src/server.ts` resumes those runs when it starts. If a stored response is gone, because it's older than 30 days, the run fails with a message that says so.
8. A customer's reply continues a finished run the same way an approval does. `addReply()` saves it, and the next turn sends it as a new user message with `previous_response_id` set to the run's last stored response, so the agent has the order, the policy, and everything it already wrote without any of it being sent again. The prompt tells it how to handle pushback: stay calm, keep to the policy however hard the customer pushes, and flag threats and requests for a manager in its note for the team.
9. For the angry customer, `converse()` in `src/customer.ts` wraps `advance()`. Whenever the run finishes, it asks Grok to play the customer: a separate request with no tools and a short brief, which reads only the emails so far, not the agent's reasoning, and writes Priya's next reply, or DONE once she's had her say. The reply goes into the run like one a person typed, and the run continues. It stops after three replies, so two models can't argue forever, and Grok's requests as the customer count toward the run's cost.

Each turn uses a low reasoning effort, since it only picks the next tool or writes a short email. When we tried the refund decision at the default effort, it took 15 to 47 seconds instead of 2 to 9, and came to the same $48.00. The client also retries a request that fails before Grok starts answering, such as on a rate limit, up to five times. A run's cost adds up what the API reports in `usage.cost_usd` for each of its requests.

`src/server.ts` is a small `node:http` server. Each open page keeps one stream of server-sent events, which carries every change to every run, so the queue looks the same in every tab. When the server goes away, the page's `EventSource` keeps trying to reconnect, and the new process sends a fresh snapshot loaded from `output/`. Actions are POST requests: start a run, stop or resume one, and approve or reject a refund. Each request to the API gets an `AbortSignal`. Stop aborts it, and so does closing the page that started the run, which leaves the run stopped at its last stored response, ready for Resume. A run waiting for approval has nothing in flight, so closing the page leaves it in the queue. `public/index.html` is plain HTML and JavaScript that shows those events, and `src/index.ts` does the same work in the terminal.
