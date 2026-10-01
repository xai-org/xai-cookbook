# Patient Intake Voice Agent

A family-medicine front desk you can call. The agent identifies a caller against a
chart, books and moves appointments, answers practice-policy questions, collects
pre-visit clinical intake, and routes a possible emergency to urgent care — all in
one conversation, over voice.

The whole speech pipeline is xAI:

| Stage | Model |
| --- | --- |
| Speech to text | `xai/stt-1` |
| Reasoning | `xai/grok-4.20-0309-non-reasoning` |
| Text to speech | `xai/tts-1` (voice `carina`) |

Transport, turn detection, and telephony come from [LiveKit Agents](https://docs.livekit.io/agents/).

> **Example implementation for learning and development.** Not production-ready
> without additional hardening — see the disclaimer in [../agent/README.md](../agent/README.md).
> The clinic is an in-memory fake. No real patient data is involved, and nothing
> here is a medical device or a source of medical advice.

## Design

One agent, one conversation, one fixed tool surface. No handoffs, no task
framework, no workflow state machine. The model holds the conversation in its own
context and passes what it has learned to typed tools when it needs to read or
change practice state.

| Tool | Purpose |
| --- | --- |
| `read_practice_information` | Read the complete published practice guide |
| `find_open_times` | Search real slots using typed patient and scheduling facts |
| `book_appointment` | Register a new patient when necessary and book their chosen slot |
| `manage_appointment` | List, cancel, or reschedule an existing appointment |
| `take_message` | Route a refill, results, billing, referral, nurse, or records request |
| `update_insurance` | Save details from a current insurance card |
| `record_previsit_intake` | Save one completed set of pre-visit answers |
| `record_emergency_escalation` | Record a possible emergency and end ordinary work |

Every tool re-verifies identity from its arguments rather than trusting remembered
state, so a caller can book a visit, report a symptom, and update insurance in any
order without a phase machine deciding what is allowed next.

Practice policy stays out of the prompt: `agent/src/clinic/practice_info/` holds the
published guide as Markdown, and one argument-free tool returns all of it, leaving
interpretation to the model instead of a category table.

## Layout

```
agent/   Python voice agent (LiveKit Agents + xAI models)
  src/
    agent.py       session composition — models, audio, turn handling
    reception.py   the agent and its eight tools
    clinic/        framework-free in-memory practice
    prompts/       authored instructions as Markdown
web/     Next.js app that dispatches the agent and renders the conversation
```

## Run it

Both halves point at the same LiveKit Cloud project. Create one, then copy its URL,
API key, and API secret into each `.env.local`.

**1. Start the agent**

```bash
cd agent
cp .env.example .env.local     # fill in the three LiveKit values
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python src/agent.py console    # talk to it in the terminal
python src/agent.py dev        # or register the worker for the web app
```

**2. Start the web app**

```bash
cd web
cp .env.example .env.local     # the same three values
pnpm install
pnpm dev
```

Open http://localhost:3000/patient-intake and click the card. The route at
`web/app/api/agent/connection_details/route.ts` mints a token that dispatches the
worker registered as `xai-patient-intake`, so the agent joins the room the visitor
just created.

`console` mode needs no web app at all and is the fastest way to try the agent.
