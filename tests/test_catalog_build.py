import importlib.util
import json
from pathlib import Path
import pytest

BUILD_SCRIPT = Path(__file__).resolve().parents[1] / "catalog" / "build.py"
SPEC = importlib.util.spec_from_file_location("catalog_build", BUILD_SCRIPT)
assert SPEC is not None and SPEC.loader is not None
catalog_build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog_build)


@pytest.mark.parametrize("front_matter", ["- one\n- two", "plain scalar string"])
def test_read_front_matter_rejects_non_mapping_yaml(tmp_path, front_matter):
    readme = tmp_path / "README.md"
    readme.write_text(f"---\n{front_matter}\n---\n", encoding="utf-8")

    with pytest.raises(ValueError, match="front matter must be a YAML mapping"):
        catalog_build.read_front_matter(readme)


def test_load_examples_does_not_append_on_missing_code_dir(tmp_path, monkeypatch):
    examples = tmp_path / "examples"
    example = examples / "broken-code-dir"
    example.mkdir(parents=True)
    (example / "README.md").write_text(
        "---\n"
        "title: Broken Example\n"
        "description: Testing missing code folder\n"
        "type: recipe\n"
        "level: beginner\n"
        "languages: [python]\n"
        "capabilities: [chat]\n"
        "authors: [Tester]\n"
        "date: 2026-01-01\n"
        "---\n",
        encoding="utf-8",
    )
    # python code folder is intentionally NOT created

    monkeypatch.setattr(catalog_build, "ROOT", tmp_path)
    monkeypatch.setattr(catalog_build, "EXAMPLES", examples)

    loaded, errors = catalog_build.load_examples()
    assert loaded == []
    assert any("python code folder 'python' doesn't exist" in e for e in errors)


def test_load_examples_does_not_append_on_missing_notebook(tmp_path, monkeypatch):
    examples = tmp_path / "examples"
    example = examples / "broken-notebook"
    example.mkdir(parents=True)
    (example / "python").mkdir(parents=True)
    (example / "README.md").write_text(
        "---\n"
        "title: Broken Notebook Example\n"
        "description: Testing missing notebook\n"
        "type: guide\n"
        "level: intermediate\n"
        "languages: [python]\n"
        "capabilities: [chat]\n"
        "notebook: python/guide.ipynb\n"
        "authors: [Tester]\n"
        "date: 2026-01-01\n"
        "---\n",
        encoding="utf-8",
    )
    # python/guide.ipynb is intentionally NOT created

    monkeypatch.setattr(catalog_build, "ROOT", tmp_path)
    monkeypatch.setattr(catalog_build, "EXAMPLES", examples)

    loaded, errors = catalog_build.load_examples()
    assert loaded == []
    assert any("notebook 'python/guide.ipynb' doesn't exist" in e for e in errors)


def test_broken_links_detects_html_src(tmp_path, monkeypatch):
    doc = tmp_path / "doc.md"
    doc.write_text(
        'Here is an image: <img src="images/missing.png" alt="Missing">\n'
        'And another: <img src=\'images/missing2.png\'>\n',
        encoding="utf-8",
    )

    monkeypatch.setattr(catalog_build, "ROOT", tmp_path)
    monkeypatch.setattr(catalog_build, "markdown_files", lambda: [doc])

    broken = catalog_build.broken_links()
    assert len(broken) == 2
    assert any("images/missing.png" in b for b in broken)
    assert any("images/missing2.png" in b for b in broken)


def test_render_catalog_safe_language_fallback():
    examples = [
        {
            "slug": "csharp-sample",
            "title": "C# Sample",
            "type": "app",
            "level": "intermediate",
            "description": "C# app description",
            "languages": ["csharp"],
            "code": {"csharp": "csharp/"},
        }
    ]
    catalog = catalog_build.render_catalog(examples)
    assert "[Csharp]" in catalog or "[C#]" in catalog
