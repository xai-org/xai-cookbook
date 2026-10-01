# xAI Cookbook

Runnable examples for building with Grok: complete voice agent apps for the browser, phone calls, iOS, and Android, and a Python notebook that analyzes live posts from 𝕏. Each example teaches one idea end to end, and the code is meant to be copied.

New to the API? Start with the [quickstart](https://docs.x.ai/developers/quickstart) in the xAI docs, browse the [models](https://docs.x.ai/developers/models), and get an API key from the [xAI Console](https://console.x.ai).

## Start here

- **Voice:** [Web Voice Agent](examples/voice-agent-web/), a browser app you can talk to.
- **𝕏 data:** [Real-Time Sentiment Analysis on 𝕏](examples/x-sentiment-analysis/), a notebook that searches 𝕏 live and scores sentiment. It keeps its outputs, so you can read it on GitHub without running anything.

## Examples

Every example is a folder under [`examples/`](examples/) with a README that explains what it teaches and how to run it. This list is generated from those READMEs.

<!-- catalog:start -->
### Guides

| Example | What you'll learn | Level | Code |
| --- | --- | --- | --- |
| [Real-Time Sentiment Analysis on 𝕏](examples/x-sentiment-analysis/) | Pull the latest posts from 𝕏 with Grok's X Search tool, filter out the noise with a quick pass, and score sentiment with a deeper one. | Advanced | [Python](examples/x-sentiment-analysis/python/) |

### Apps

| Example | What you'll learn | Level | Code |
| --- | --- | --- | --- |
| [Mobile Voice Apps](examples/voice-agent-mobile/) | Native iOS and Android apps for real-time voice conversations with Grok, plus text-to-speech on iOS. | Intermediate | [Swift](examples/voice-agent-mobile/swift/) · [Kotlin](examples/voice-agent-mobile/kotlin/) |
| [Phone Voice Agent](examples/voice-agent-phone/) | A voice agent you can call on the phone, using Twilio or Plivo. | Intermediate | [TypeScript](examples/voice-agent-phone/xai/) |
| [Web Voice Agent](examples/voice-agent-web/) | A React client with swappable Python and Node.js backends that talk to the Voice Agent API over WebSocket. | Intermediate | [TypeScript](examples/voice-agent-web/) · [Python](examples/voice-agent-web/xai/backend-python/) |
| [WebRTC Voice Agent](examples/voice-agent-webrtc/) | A low-latency browser voice agent that uses WebRTC between the browser and a server, which connects to xAI over WebSocket. | Advanced | [TypeScript](examples/voice-agent-webrtc/) |
<!-- catalog:end -->

The apps are for learning and aren't production-ready as-is.

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

The first cell of each notebook installs the packages that notebook needs. Running a notebook calls the API, so it uses your credits. Each app's README covers its own setup.

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

Want to add an example? See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. In short:
- Copy [`templates/example/`](templates/example/) to `examples/<name>/` and fill in the front matter at the top of its README.
- Put the code in a folder named after its language, like `python/`.
- Run `uv run catalog/build.py` to update the list above and `registry.yaml`.
- Test that it runs end to end, then open a PR.

### Pre-commit hooks

Install the hooks with `uv run pre-commit install`. On each commit, they:
- Scan for API keys with Gitleaks. This isn't foolproof, so if you ever commit a key, revoke it right away.
- Run any notebook you changed from start to finish.
- Check each example's front matter, that the list of examples is up to date, and that relative links resolve.

Running notebooks costs API credits, so it's fine to skip the hooks with `git commit --no-verify` while you iterate. Please run them at least once before you open or update a pull request.

## License

See [LICENSE](LICENSE).
