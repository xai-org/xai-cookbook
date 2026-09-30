# Contributing to xAI Cookbooks

Thanks for your interest in contributing to `xai-cookbook`! We’re excited to see your ideas and have some guidelines to ensure high quality and value.

## What We’re Looking For

New cookbooks should:
- **Be High Quality**: Deliver clear value with working, well-tested examples that showcase Grok APIs effectively.
- **Be Unique**: Bring something fresh, check existing cookbooks to avoid overlap.
- **Be Well-Written**: Use clear, concise language, avoiding jargon or ambiguity.
- **Follow Good Coding Practices**: Write clean, readable, well-commented code.

Before submitting, ask:
- Does this solve a real problem or teach something useful?
- Is it distinct from existing content?
- Would I want to use this myself?

## How to Contribute

1. **Fork the Repository**: Click "Fork" at the top right to create your copy.
2. **Clone Your Fork**: `git clone https://github.com/your-username/xai-cookbook.git`
3. **Create a Branch**: Use a descriptive name, e.g., `git checkout -b add-image-analysis-cookbook`.
4. **Add Your Cookbook**:
   - For standalone notebooks, save as `examples/<notebook_title>.ipynb`.
   - For notebooks with files, create `examples/<Title>/` with the notebook and all dependencies.
   - Test thoroughly, your notebook should be runnable end-to-end out of the box (assuming a valid API key is provided)
   - **Style**:
     - Use clear, descriptive cell titles for sections or steps.
     - Write Python in code cells; explanations in markdown cells.
     - Add images as `![alt text](image_source)` or use `display` from `IPython.display` (no HTML).
   - **Dependencies**:
     - Minimize dependencies.
     - Use `%pip install <package1> <package2>`.
     - Commercial packages are fine but must not be promotional or imply xAI endorsement.
   - Add your notebook to `registry.yaml` and to the notebook table in `README.md`.
5. **Commit Changes**: Use clear messages, e.g., `git commit -m "Add text summarization cookbook"`.
6. **Push to Your Fork**: `git push origin your-branch-name`
7. **Open a Pull Request**:
   - Visit the original repo, click "New Pull Request," and select your branch.
   - Provide a detailed description that adheres to the pull request template (see below).

## Pull Request Guidelines
- **Title**:
  - For new content: [Content] Title
  - For improving existing content: [Improvement] Title
  - For bug fix: [BugFix] Title
- **Description**: Explain what it does, why it’s useful, and any setup notes or dependencies.
- **Checklist**:
  - Run all cells in your Jupyter Notebook to ensure all outputs are shown and there are no errors.
  - Add your Juptyer Notebook in registry.yaml using relative path to the repo.
  - Push your changes to your fork and then open a PR to the main repo.
  - Use the PR template.

We may suggest changes—please respond to feedback to keep the repo sharp.

## Questions?

Unsure about your idea? Open an issue to discuss it first. Let’s make this a great resource together.

Happy coding!