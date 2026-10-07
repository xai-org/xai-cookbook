# Patient intake

A deliberately small LiveKit voice agent for Maplewood Family Medicine.

The design is one agent, one conversation, and one fixed tool surface. The language
model remembers what the caller has said and supplies those facts to typed tools when
it needs to read or change practice state. There are no tasks, handoffs, dynamically
scoped tools, or workflow state machines.

## Shape

`src/reception.py` contains the complete model-facing surface:

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

The tool names, typed parameters, and docstrings tell the model when and how to use
them. The prompt supplies conversational judgment: listen, retain facts, ask one
question at a time, and never claim an action before its tool succeeds.

`src/clinic/` is a framework-free in-memory practice: providers, patients, slots,
appointments, messages, insurance, and intake records. `src/agent.py` only composes
the LiveKit session and audio pipeline.

Practice policy stays out of the main prompt. `src/clinic/practice_info/` stores the
published guide as small Markdown files. One argument-free tool returns the complete
guide, leaving interpretation to the model rather than a category table.

## Run

```bash
cp .env.example .env.local
python -m venv .venv && source .venv/bin/activate   # Windows: .venv/Scripts/activate
pip install -r requirements.txt
python src/agent.py console
python src/agent.py dev
```

`console` talks to the agent in your terminal; `dev` registers the worker with
LiveKit Cloud. Both read credentials from `.env.local`.

The xAI TTS uses `optimize_streaming_latency=1`. Every model and audio setting is a
literal in the single `AgentSession(...)` call in `src/agent.py`.
