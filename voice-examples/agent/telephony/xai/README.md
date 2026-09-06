# XAI Native Telephony Examples

Native XAI Realtime voice agents over telephony providers. Audio is mu-law 8 kHz (`audio/pcmu`) end-to-end.

## Providers

| Provider | Path | Notes |
| --- | --- | --- |
| [Twilio](./twilio/) | `xai/twilio/` | Twilio Media Streams |
| [Plivo](./plivo/) | `xai/plivo/` | Plivo Audio Streaming |

Both examples use Node.js + TypeScript, Express + express-ws, and bidirectional mu-law passthrough with barge-in.
