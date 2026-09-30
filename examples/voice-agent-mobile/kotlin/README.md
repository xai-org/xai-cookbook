# xAI Voice API Android Example

An Android example app demonstrating the [xAI Realtime Voice API](https://docs.x.ai/docs/guides/realtime-voice-overview). Supports voice conversations and text messaging with Grok.

See the [xAI Voice Agent API docs](https://docs.x.ai/developers/model-capabilities/audio/voice-agent) for API reference.

## Setup

1. Get an API key from [console.x.ai](https://console.x.ai/)
2. Create `local.properties` in the project root:
   ```
   xai.api.key=YOUR_API_KEY
   ```
3. Open the project in Android Studio and run on a device or emulator (API 30+)

### Production: Ephemeral Tokens

For production apps, implement `AuthService.getEphemeralToken()` to fetch short-lived tokens from your backend instead of hardcoding API keys in the client. See [AuthService.kt](/app/src/main/java/ai/x/voiceapiandroidexample/AuthService.kt) for guidance.

Learn more: [Ephemeral Tokens](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens)

## Features

- Real-time voice conversation via WebSocket
- Text message input with automatic connect-on-send
- Mic and speaker toggle controls