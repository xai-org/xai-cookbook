# Voice API Tester

A minimal iOS/macOS app for testing the [xAI Text-to-Speech API](https://docs.x.ai/docs/guides/tts). Type text, pick a voice, and listen to the result — all from a single SwiftUI screen.

## Features

- **Text-to-Speech** — send any text to the `/v1/tts` endpoint and play back the audio
- **Voice picker** — choose from five built-in voices
- **Playback & sharing** — play the generated MP3 inline or share it via the system share sheet
- **API key management** — store your xAI API key in-app or pass it as an Xcode environment variable

## Voices

| Voice | Tone | Description |
|-------|------|-------------|
| Eve | Energetic, upbeat | Default voice — engaging and enthusiastic |
| Ara | Warm, friendly | Balanced and conversational |
| Rex | Confident, clear | Professional and articulate — ideal for business |
| Sal | Smooth, balanced | Versatile voice for a wide range of contexts |
| Leo | Authoritative, strong | Commanding and decisive — great for instructional content |

## Getting Started

1. **Clone the repo**
   ```bash
   git clone git@github.com:xai-org/VoiceAPITesterApp.git
   ```
2. **Open in Xcode** — double-click `VoiceTesterApp.xcodeproj`
3. **Add your API key** — either:
   - Launch the app and go to **API Keys** to save it in UserDefaults, or
   - Set `XAI_API_KEY` as an environment variable in the Xcode scheme (Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables)
4. **Run** on a simulator or device

## Requirements

- Xcode 16+
- iOS 17+ / macOS 14+
- An [xAI API key](https://console.x.ai/)

## Project Structure

```
VoiceTesterApp/
├── VoiceTesterAppApp.swift   # App entry point
├── ContentView.swift         # Root navigation list
├── TextToSpeechView.swift    # TTS demo screen
├── APIKeysView.swift         # API key management
└── VoiceID.swift             # VoiceID enum with metadata
```

## License

Internal — xAI
