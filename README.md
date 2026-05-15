# xAI Cookbooks

A collection of pragmatic, real-world examples guiding you from basic to advanced use of xAI's Grok APIs for practical, powerful applications.

## How to Run the Notebooks Yourself

Below are steps to run these notebooks locally with your own API key, which you can obtain over at the [xAI Console](https://console.x.ai). If you’d rather not run them, all notebook cells are preserved with outputs intact, so you can follow along just by reading.

### Prerequisites
- Install [uv](https://github.com/astral-sh/uv) for managing Python dependencies.

### Setup
1. Clone this repo:
   ```bash
   git clone https://github.com/xai-org/xai-cookbook.git
   cd xai-cookbook
   ```

2. Install dependencies:
   ```bash
   uv sync
   ```

3. Install pre-commit hooks:
   ```bash
   uv run pre-commit install
   ```

4. Configure git lfs (install it if you haven't already):
   ```bash
   git lfs install
   ```

5. Copy the `.env.example` file and rename it to `.env` and add your API key (the repo is set up to ignore `.env` so that it won't be committed):
   ```bash
   cp .env.example .env
   ```

6. Launch Jupyter in the notebook directory and run the desired notebook:
   ```bash
   uv run jupyter notebook examples/
   ```
   
Alternatively, use VS Code’s notebook extension:
- Open the notebook in VS Code.
- Set the Python interpreter to `.venv` (created by `uv sync`) via the interpreter selector.
- Run directly in VS Code.

### API Key Security

**Never hardcode API keys** (e.g., XAI_API_KEY=my-key), even during development. This risks accidental commits. Instead, use the .env file. In your notebook, load the key like this:

```python
from dotenv import load_dotenv
import os

load_dotenv()
XAI_API_KEY = os.getenv("XAI_API_KEY")
```

### Git LFS for Large Files
This repo uses Git LFS to track large data files (e.g., images, large JSON) used by some notebooks. To work with these files:

Install Git LFS: 
```bash 
git lfs install
```

Files are tracked via `.gitattributes`, check or update it if adding new large files.

### Pre-commit Hooks
This repo includes a pre-commit hook with Gitleaks to block accidental API key commits. It’s not foolproof though, if you accidentally commit your key, revoke it immediately in the xAI Console and generate a new one.

There’s also a pre-commit hook to verify that your notebooks run end-to-end without errors.

It’s fine to skip these hooks during development using `git commit --no-verify`, especially if your notebook makes frequent requests to the xAI APIs, skipping can help preserve your API credits. That said, we strongly encourage you to run your changes with the hooks enabled at least once before submitting a pull request or responding to comments on an open PR. This ensures code quality and catches potential issues. To manually trigger the hooks, use pre-commit run after staging your changes. (e.g. `uv run pre-commit run --files examples/your_notebook.ipynb`)

## Contributing
Want to add a notebook? See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Key steps:
- Develop your notebook with `uv run jupyter notebook examples/`.
- Test it runs end-to-end.
- If adding large files (e.g., images, JSON), update `.gitattributes` for Git LFS.
- Submit a PR!
