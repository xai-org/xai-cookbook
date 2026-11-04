"""Session state for one patient-intake call."""

from dataclasses import dataclass

from clinic import Clinic


@dataclass(slots=True)
class Visit:
    """The per-call clinic mutated by the agent's tools."""

    clinic: Clinic
