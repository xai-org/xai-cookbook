---
title: Mobile Voice Apps
description: Native iOS and Android apps for real-time voice conversations with Grok, plus text-to-speech on iOS.
type: app
level: intermediate
languages: [swift, kotlin]
capabilities: [voice, text-to-speech]
authors: [Ege Cavusoglu, Vladimir Tagakov]
date: 2026-03-23
---

# Mobile Voice Apps

Two native apps built on the [Voice Agent API](https://docs.x.ai/developers/model-capabilities/audio/voice). Each folder's README covers setup.

- [`swift/`](swift/): a SwiftUI app for iOS and macOS with text-to-speech, streaming text-to-speech, and real-time voice agents. Open `VoiceTesterApp.xcodeproj` in Xcode 16 or newer.
- [`kotlin/`](kotlin/): an Android app for real-time voice conversations and text messaging with Grok. Open it in Android Studio.

Both are for learning and aren't production-ready as-is. In a real app, fetch short-lived [ephemeral tokens](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens) from your backend instead of putting an API key in the client.
