"""Published practice information loaded from Markdown."""

from importlib.resources import files


class PracticeInfo:
    """The published facts the front desk may state about the practice."""

    def __init__(self) -> None:
        self._guide = self._load()

    @staticmethod
    def _load() -> str:
        sections = []
        for resource in sorted(
            files("clinic.practice_info").iterdir(), key=lambda item: item.name
        ):
            if resource.name.endswith(".md"):
                sections.append(resource.read_text(encoding="utf-8").strip())
        return "\n\n".join(sections)

    def guide(self) -> str:
        """Return the complete published guide without classifying the question."""
        return self._guide
