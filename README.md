# xAI Cookbook

Runnable examples for building with Grok: a TypeScript app that turns articles into podcast episodes, complete voice agent apps for the browser, phone calls, iOS, and Android, and a Python notebook that analyzes live posts from 𝕏. Each example teaches one idea end to end, and the code is meant to be copied.

New to the API? Start with the [quickstart](https://docs.x.ai/developers/quickstart) in the xAI docs, browse the [models](https://docs.x.ai/developers/models), and get an API key from the [xAI Console](https://console.x.ai).

## Start here

- **TypeScript:** [Podcast from a Link](examples/podcast-from-a-link/), which turns any article into a two-host episode with a few calls to the xAI SDK.
- **Voice:** [Web Voice Agent](examples/voice-agent-web/), a browser app you can talk to.
- **𝕏 data:** [Real-Time Sentiment Analysis on 𝕏](examples/x-sentiment-analysis/), a notebook that searches 𝕏 live and scores sentiment. It keeps its outputs, so you can read it on GitHub without running anything.

## Examples

Every example is a folder under [`examples/`](examples/) with a README that explains what it teaches and how to run it. This list is generated from those READMEs.

<!-- catalog:start -->
### Recipes

| Example | What you'll learn | Level | Code |
| --- | --- | --- | --- |
| [Article to Read-Along](examples/article-to-read-along/) | Turn any article into audio that highlights each word as it's spoken, using the per-character timestamps from text to speech, and click a word to jump there. | Beginner | [TypeScript](examples/article-to-read-along/typescript/) |
| [Live Interpreter](examples/live-interpreter/) | Speak one language and hear Grok say it in another a moment later, from a page that connects straight to the realtime voice API with a short-lived token. | Beginner | [TypeScript](examples/live-interpreter/typescript/) |
| [Photo to Talking Character](examples/photo-to-talking-character/) | Make a drawing, a mascot, or a pet photo talk in a voice you pick, and have a second character answer, with Grok Imagine reference-to-video. | Beginner | [TypeScript](examples/photo-to-talking-character/typescript/) |
| [Database over MCP](examples/database-over-mcp/) | Serve a SQLite database as a small MCP server that only reads, and watch Grok list its tables, read their schemas, and run SQL through it to answer a question. | Intermediate | [TypeScript](examples/database-over-mcp/typescript/) |
| [Progressive Tool Disclosure](examples/progressive-tool-disclosure/) | Give Grok 203 tools from a made-up company's eight work apps, show it only their names, and let it load the few each question needs with tool search. | Intermediate | [TypeScript](examples/progressive-tool-disclosure/typescript/) |

### Guides

| Example | What you'll learn | Level | Code |
| --- | --- | --- | --- |
| [Prompt Caching](examples/prompt-caching/) | Play one 30-message chat three ways to see what the prompt cache saves, how the time at the top of the system prompt breaks it, and what compaction costs. | Intermediate | [TypeScript](examples/prompt-caching/typescript/) |
| [Prompt Injection Defenses](examples/prompt-injection-defenses/) | Watch poisoned pages try to make an agent leak private data, see each of four defenses miss an attack another catches, and stop all ten with all four on. | Intermediate | [TypeScript](examples/prompt-injection-defenses/typescript/) |
| [Real-Time Sentiment Analysis on 𝕏](examples/x-sentiment-analysis/) | Pull the latest posts from 𝕏 with Grok's X Search tool, filter out the noise with a quick pass, and score sentiment with a deeper one. | Advanced | [Python](examples/x-sentiment-analysis/python/) |
| [Refund Agent with Human Approval](examples/refund-agent-human-approval/) | Build a support agent that stops before a refund, waits for a person to approve it, and resumes the same run from a stored response, even after a restart. | Advanced | [TypeScript](examples/refund-agent-human-approval/typescript/) |

### Apps

| Example | What you'll learn | Level | Code |
| --- | --- | --- | --- |
| [Podcast from a Link](examples/podcast-from-a-link/) | Turn an article or a PDF into a two-host podcast episode, and watch it being written and recorded live in a small web app. | Beginner | [TypeScript](examples/podcast-from-a-link/typescript/) |
| [Screenshot to React Component](examples/screenshot-to-component/) | Turn a screenshot of a UI into a React component styled with Tailwind, then have Grok compare the result with the original and fix what doesn't match. | Beginner | [TypeScript](examples/screenshot-to-component/typescript/) |
| [Company to Call Brief](examples/company-to-call-brief/) | Prep for a sales call with a one-page brief, as Grok searches the web and 𝕏 and looks up the account through CRM functions that run in your app. | Intermediate | [TypeScript](examples/company-to-call-brief/typescript/) |
| [CSV to Answers](examples/csv-to-answers/) | Drop in a CSV and ask questions about it. Grok writes and runs pandas in a sandbox, shows the code it ran, and answers with computed numbers and a chart. | Intermediate | [TypeScript](examples/csv-to-answers/typescript/) |
| [Docs to Cited Answers](examples/docs-to-cited-answers/) | Ask questions about a folder of documents and get answers that cite the passages they came from, with a metadata filter that decides which documents count. | Intermediate | [TypeScript](examples/docs-to-cited-answers/typescript/) |
| [Mobile Voice Apps](examples/voice-agent-mobile/) | Native iOS and Android apps for real-time voice conversations with Grok, plus text-to-speech on iOS. | Intermediate | [Swift](examples/voice-agent-mobile/swift/) · [Kotlin](examples/voice-agent-mobile/kotlin/) |
| [Phone Voice Agent](examples/voice-agent-phone/) | A voice agent you can call on the phone, using Twilio. | Intermediate | [TypeScript](examples/voice-agent-phone/xai/) |
| [Photo to Time-Lapse](examples/photo-to-time-lapse/) | Turn one photo into a time-lapse, like a street through the four seasons, by editing it for each stage and pinning every edit in one Grok Imagine video. | Intermediate | [TypeScript](examples/photo-to-time-lapse/typescript/) |
| [Product Photo to Video Ad](examples/product-video-ad/) | Turn one product photo into a vertical video ad with a voiceover, as Grok writes the brief, places the product in three scenes, picks one, and animates it. | Intermediate | [TypeScript](examples/product-video-ad/typescript/) |
| [Reasoning Effort Evals](examples/reasoning-effort-evals/) | Run a prompt's test cases at every reasoning effort, grade the answers with code checks and a judge, and find the cheapest effort that's still good enough. | Intermediate | [TypeScript](examples/reasoning-effort-evals/typescript/) |
| [Receipts to Spreadsheet](examples/receipts-to-spreadsheet/) | Turn receipt photos and PDF invoices into a spreadsheet that adds up, with Grok reading each one twice and flagging the cells where the reads disagree. | Intermediate | [TypeScript](examples/receipts-to-spreadsheet/typescript/) |
| [Reviews to Themes](examples/reviews-to-themes/) | Turn a thousand app reviews into ranked themes with counts, trends, and quotes by labeling every review in one Batch API job. | Intermediate | [TypeScript](examples/reviews-to-themes/typescript/) |
| [Storyboard to Short Film](examples/storyboard-to-film/) | Turn a one-line premise into a four-shot short film with Grok Imagine keyframes, image-to-video, and narration, and watch it being made in a small web app. | Intermediate | [TypeScript](examples/storyboard-to-film/typescript/) |
| [Topics to Morning Briefing](examples/topics-to-morning-briefing/) | Turn a few topics into a two-minute spoken briefing from 𝕏 and the web, with Grok skipping the stories it already told you about and a cost cap on every run. | Intermediate | [TypeScript](examples/topics-to-morning-briefing/typescript/) |
| [Web Voice Agent](examples/voice-agent-web/) | A React client with swappable Python and Node.js backends that talk to the Voice Agent API over WebSocket. | Intermediate | [TypeScript](examples/voice-agent-web/) · [Python](examples/voice-agent-web/xai/backend-python/) |
| [𝕏 Post to Fact-Check](examples/x-post-fact-check/) | Paste a link to a post on 𝕏, and Grok checks each claim on the web and on 𝕏 at the same time and writes a note where every sentence cites a source. | Intermediate | [TypeScript](examples/x-post-fact-check/typescript/) |
| [𝕏 Sentiment Tracker](examples/x-sentiment-tracker/) | Score the sentiment about any topic from live 𝕏 posts with Grok's X Search tool, on a dashboard with a score for every post and the sentiment day by day. | Intermediate | [TypeScript](examples/x-sentiment-tracker/typescript/) |
| [Bug Report to Fix](examples/bug-report-to-fix/) | Describe a bug in a small repo, and watch Grok reproduce it with a failing test, fix it, and rerun the tests, checking every command before it runs. | Advanced | [TypeScript](examples/bug-report-to-fix/typescript/) |
| [Meeting to Action Items](examples/meeting-to-action-items/) | Caption a call live by speaker, keep a running list of decisions and action items, and ask questions whose answers link to the moment in the transcript. | Advanced | [TypeScript](examples/meeting-to-action-items/typescript/) |
| [Video Dubbing](examples/video-dubbing/) | Dub a video into another language, with each line timed to the original speech, shortened by Grok when it runs long, and mixed over the original background. | Advanced | [TypeScript](examples/video-dubbing/typescript/) |
| [WebRTC Voice Agent](examples/voice-agent-webrtc/) | A low-latency browser voice agent that uses WebRTC between the browser and a server, which connects to xAI over WebSocket. | Advanced | [TypeScript](examples/voice-agent-webrtc/) |
<!-- catalog:end -->

The apps are for learning and aren't production-ready as-is.

## Run the TypeScript apps

Each app in a `typescript/` folder is its own npm project built on the [xAI TypeScript SDK](https://www.npmjs.com/package/@xai-official/sdk). You'll need Node.js 22.13 or newer and an API key from the [xAI Console](https://console.x.ai). Copy `.env.example` to `.env` at the root of the repo and add your key, then:

```bash
cd examples/podcast-from-a-link/typescript
npm install
npm start -- https://en.wikipedia.org/wiki/Voyager_Golden_Record
```

Each app's README lists the arguments it takes. Apps that generate images or video cost more to run, and their READMEs say how much.

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
