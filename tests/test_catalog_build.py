import importlib.util
import json
from pathlib import Path

import pytest


BUILD_SCRIPT = Path(__file__).resolve().parents[1] / "catalog" / "build.py"
SPEC = importlib.util.spec_from_file_location("catalog_build", BUILD_SCRIPT)
assert SPEC is not None and SPEC.loader is not None
catalog_build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog_build)


@pytest.mark.parametrize("front_matter", ["- one\n- two", "example"])
def test_read_front_matter_rejects_non_mapping_yaml(tmp_path, front_matter):
    readme = tmp_path / "README.md"
    readme.write_text(f"---\n{front_matter}\n---\n", encoding="utf-8")

    with pytest.raises(ValueError, match="front matter must be a YAML mapping"):
        catalog_build.read_front_matter(readme)


def test_load_examples_reports_non_mapping_front_matter(tmp_path, monkeypatch):
    examples = tmp_path / "examples"
    example = examples / "bad-front-matter"
    example.mkdir(parents=True)
    (example / "README.md").write_text("---\n- one\n- two\n---\n", encoding="utf-8")
    schema = tmp_path / "schema.json"
    schema.write_text(json.dumps({"type": "object"}), encoding="utf-8")

    monkeypatch.setattr(catalog_build, "ROOT", tmp_path)
    monkeypatch.setattr(catalog_build, "EXAMPLES", examples)
    monkeypatch.setattr(catalog_build, "SCHEMA", schema)

    loaded, errors = catalog_build.load_examples()

    assert loaded == []
    assert errors == [
        "examples/bad-front-matter/README.md: front matter must be a YAML mapping"
    ]
