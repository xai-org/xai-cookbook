"""The agent's authored language, loaded like application templates."""

from datetime import datetime
from functools import cache
from importlib.resources import files


@cache
def prompt(name: str) -> str:
    resource = files(__package__).joinpath(f"{name}.md")
    if not resource.is_file():
        raise FileNotFoundError(f"no prompt named {name!r}")
    return resource.read_text(encoding="utf-8")


def instructions(*names: str, now: datetime, about: str = "") -> str:
    clock = f"{now.hour % 12 or 12}:{now:%M %p}"
    dated = f"Today is {now:%A, %B} {now.day}, {now.year}. The time is {clock}."
    parts = [dated, *(prompt(name) for name in names)]
    return "\n\n".join([*parts, about] if about else parts)
