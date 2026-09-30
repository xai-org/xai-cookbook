# xAI Cookbooks

Practical, runnable examples for building with xAI's Grok APIs: Jupyter notebooks that walk through common tasks step by step, plus complete voice agent apps for the browser, phone calls, iOS, and Android.

New to the API? Start with the [xAI docs](https://docs.x.ai), browse the [models](https://docs.x.ai/developers/models), and get an API key from the [xAI Console](https://console.x.ai).

## What's in this repo

| Folder | What's inside |
| --- | --- |
| [`examples/`](examples/) | Python notebooks, one per topic. Their outputs are saved, so you can read them on GitHub without running anything. |
| [`voice-examples/agent/`](voice-examples/agent/) | Voice agent apps for the browser (WebSocket and WebRTC) and for phone calls. |
| [`iOS/VoiceTesterApp/`](iOS/VoiceTesterApp/) | A SwiftUI app for text-to-speech and real-time voice agents on iOS and macOS. |
| [`Android/VoiceApiAndroidExample/`](Android/VoiceApiAndroidExample/) | An Android app for real-time voice conversations with Grok. |
| [`registry.yaml`](registry.yaml), [`images/`](images/) | The notebook index and cover images that the xAI docs site reads. |

## Notebooks

If you're new, work through them roughly in this order:

| Notebook | What you'll learn | Also needs |
| --- | --- | --- |
| [Function Calling 101](examples/function_calling_101/guide.ipynb) | Define tools, let Grok decide when to call them, and feed the results back. Uses the free US National Weather Service API. | Nothing extra |
| [Building a Unified Chat Experience](examples/multi_turn_conversation/guide.ipynb) | Multi-turn chat with streaming, function calling, structured outputs, and image understanding. | Its chat loops are interactive, so you type messages while the cells run |
| [Object Detection](examples/multimodal/object_detection/guide.ipynb) | Count and locate objects in photos, including niche objects and text in several languages, by describing what to find in plain language. | Nothing extra |
| [Structured Data Extraction](examples/multimodal/structured_data_extraction/guide.ipynb) | Turn fashion photos into structured JSON, process hundreds of images concurrently, and measure accuracy against labeled data. | A full run sends 250 images, so it takes a few minutes and uses more credits |
| [Hyper-Personalized Marketing](examples/hyper_personalized_marketing/guide.ipynb) | Generate customer profiles, then write tailored copy and generate an image for each. | Nothing extra |
| [Real-Time Sentiment Analysis on 𝕏](examples/sentiment_analysis_on_x/guide.ipynb) | Stream posts from 𝕏, filter out noise with a fast model, and score sentiment with a reasoning model. | An 𝕏 API key and secret with filtered-stream access |

The notebooks use `grok-4.7` for text and image understanding, `grok-4.3` where speed matters more than reasoning, and `grok-imagine-image-2.0` for image generation. See [Models](https://docs.x.ai/developers/models) for the current lineup.

## Voice examples

These are complete apps that show how to build with the [Voice Agent API](https://docs.x.ai/developers/model-capabilities/audio/voice). Each folder's README covers setup. They're meant for learning and aren't production-ready as-is.

- [`voice-examples/agent/web/`](voice-examples/agent/web/): a React client with interchangeable Python and Node.js backends that connect over WebSocket. It also includes backends for OpenAI's realtime API that expose the same interface, so the same client works with either.
- [`voice-examples/agent/webrtc/`](voice-examples/agent/webrtc/): a low-latency browser agent that uses WebRTC between the browser and a server, which connects to xAI over WebSocket.
- [`voice-examples/agent/telephony/`](voice-examples/agent/telephony/): voice agents you can call on the phone, using Twilio.
- [`iOS/VoiceTesterApp/`](iOS/VoiceTesterApp/): text-to-speech, streaming text-to-speech, and real-time voice agents on iOS and macOS.
- [`Android/VoiceApiAndroidExample/`](Android/VoiceApiAndroidExample/): real-time voice conversations and text messaging with Grok on Android.

## Run the notebooks

You'll need Python 3.12 or newer, [uv](https://github.com/astral-sh/uv), and an API key from the [xAI Console](https://console.x.ai).

1. Clone this repo:
   ```bash
   git clone https://github.com/xai-org/xai-cookbook.git
   cd xai-cookbook
   ```

2. Install dependencies:
   ```bash
   uv sync
   ```

3. Copy `.env.example` to `.env` and add your API key. The repo ignores `.env`, so it won't be committed.
   ```bash
   cp .env.example .env
   ```

4. Launch Jupyter and open a notebook:
   ```bash
   uv run jupyter notebook examples/
   ```

You can also open a notebook in VS Code and select the `.venv` interpreter that `uv sync` created.

The first cell of each notebook installs the packages that notebook needs. Running a notebook calls the API, so it uses your credits.

## Keep your API key safe

Never put your key directly in code, even while experimenting, because it's easy to commit by accident. Keep it in `.env` and load it like this:

```python
from dotenv import load_dotenv
import os

load_dotenv()
XAI_API_KEY = os.getenv("XAI_API_KEY")
```

If a key ever leaks, revoke it in the xAI Console and create a new one.

## Contributing

Want to add a notebook? See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Key steps:
- Develop your notebook with `uv run jupyter notebook examples/`.
- Test it runs end-to-end.
- Add it to `registry.yaml` and to the notebook table in this README.
- Commit images and data files as regular files, and keep them small.
- Submit a PR!

### Pre-commit hooks

Install the hooks with `uv run pre-commit install`. On each commit, they:
- Scan for API keys with Gitleaks. This isn't foolproof, so if you ever commit a key, revoke it right away.
- Run any notebook you changed from start to finish.
- Validate `registry.yaml`.

Running notebooks costs API credits, so it's fine to skip the hooks with `git commit --no-verify` while you iterate. Please run them at least once before you open or update a pull request. To run them by hand, stage your changes and run `uv run pre-commit run --files examples/your_notebook.ipynb`.

## License

See [LICENSE](LICENSE).
