"""Building a Clinic from a plain mapping, so a scenario and the live office share one code path."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any, cast

from .records import (
    Appointment,
    AppointmentStatus,
    Clinic,
    Insurance,
    Patient,
    Provider,
    ProviderPanel,
    Slot,
    VisitType,
)

PROVIDERS = [
    Provider(
        id="alvarez",
        name="Doctor Elena Alvarez",
        specialty="Family Medicine",
        panel=ProviderPanel.ADULT,
    ),
    Provider(
        id="chen",
        name="Doctor Marcus Chen",
        specialty="Family Medicine",
        panel=ProviderPanel.ADULT,
        accepting_new_patients=False,
    ),
    Provider(
        id="raman",
        name="Doctor Priya Raman",
        specialty="Pediatrics",
        panel=ProviderPanel.PEDIATRIC,
    ),
    Provider(
        id="whitfield",
        name="Dana Whitfield, Nurse Practitioner",
        specialty="Family Medicine",
        panel=ProviderPanel.ADULT,
    ),
]

ROSTER: list[dict[str, Any]] = [
    {
        "chart_id": "MRN10001",
        "first_name": "Dolores",
        "last_name": "Whitaker",
        "date_of_birth": "1958-03-14",
        "phone": "5550171",
        "primary_provider_id": "alvarez",
        "insurance": {"carrier": "Blue Ridge Health", "member_id": "BR8842190"},
    },
    {
        "chart_id": "MRN10002",
        "first_name": "Theo",
        "last_name": "Whitaker",
        "date_of_birth": "2019-11-05",
        "phone": "5550171",
        "primary_provider_id": "raman",
        "insurance": {"carrier": "Blue Ridge Health", "member_id": "BR8842191"},
    },
    {
        "chart_id": "MRN10003",
        "first_name": "Marcus",
        "last_name": "Bell",
        "date_of_birth": "1984-07-22",
        "phone": "5550133",
        "primary_provider_id": "chen",
        "insurance": {"carrier": "Statewide PPO", "member_id": "SW4410072"},
    },
    {
        "chart_id": "MRN10004",
        "first_name": "Rosa",
        "last_name": "Delgado",
        "date_of_birth": "1972-02-09",
        "phone": "5550119",
        "primary_provider_id": "whitfield",
        "insurance": {"carrier": "Sunline Health", "member_id": "SL2210044"},
    },
    {
        "chart_id": "MRN10005",
        "first_name": "Priya",
        "last_name": "Venkat",
        "date_of_birth": "1991-09-12",
        "phone": "5550177",
        "primary_provider_id": "alvarez",
        "insurance": {"carrier": "Meridian Choice", "member_id": "MC7781203"},
    },
    {
        "chart_id": "MRN10006",
        "first_name": "Kenji",
        "last_name": "Mori",
        "date_of_birth": "1969-12-01",
        "phone": "5550193",
        "primary_provider_id": "chen",
    },
    {
        "chart_id": "MRN10007",
        "first_name": "Tomas",
        "last_name": "Ruiz",
        "date_of_birth": "1980-08-05",
        "phone": "5550166",
        "primary_provider_id": "alvarez",
        "insurance": {"carrier": "Blue Ridge Health", "member_id": "BR9930012"},
    },
    {
        "chart_id": "MRN10008",
        "first_name": "Ana",
        "last_name": "Duarte",
        "date_of_birth": "1968-07-07",
        "phone": "5550154",
        "primary_provider_id": "alvarez",
        "insurance": {"carrier": "Evergreen Medicaid", "member_id": "EM5540918"},
    },
]

APPOINTMENT_HOURS = (
    time(8, 30),
    time(9, 30),
    time(10, 30),
    time(11, 30),
    time(13, 30),
    time(14, 30),
    time(15, 30),
)


def _providers(spec: list[dict[str, Any]] | None) -> list[Provider]:
    if spec is None:
        return list(PROVIDERS)
    return [Provider(**provider) for provider in spec]


def _patients(spec: list[dict[str, Any]] | None) -> list[Patient]:
    patients = []
    for entry in spec or []:
        insurance = entry.get("insurance")
        patients.append(
            Patient(
                chart_id=entry["chart_id"],
                first_name=entry["first_name"],
                last_name=entry["last_name"],
                date_of_birth=date.fromisoformat(entry["date_of_birth"]),
                phone=entry.get("phone", ""),
                primary_provider_id=entry.get("primary_provider_id", ""),
                insurance=Insurance(**insurance) if insurance else None,
                registered_on_this_call=entry.get("registered_on_this_call", False),
            )
        )
    return patients


def _appointments(spec: list[dict[str, Any]] | None) -> list[Appointment]:
    return [
        Appointment(
            id=entry["id"],
            chart_id=entry["chart_id"],
            provider_id=entry["provider_id"],
            start=datetime.fromisoformat(entry["start"]),
            visit_type=cast("VisitType", entry["visit_type"]),
            reason=entry.get("reason", ""),
            status=cast("AppointmentStatus", entry.get("status", "scheduled")),
        )
        for entry in spec or []
    ]


def rolling_slots(now: datetime, *, weeks: int = 3) -> list[Slot]:
    """A plain weekday schedule for every provider, used when no seed is supplied."""
    slots = []
    for offset in range(weeks * 7):
        day = (now + timedelta(days=offset)).date()
        if day.weekday() >= 5:
            continue
        for provider in PROVIDERS:
            for hour in APPOINTMENT_HOURS:
                slots.append(
                    Slot(provider_id=provider.id, start=datetime.combine(day, hour))
                )
    return slots


def upcoming_weekdays(now: datetime, count: int) -> list[date]:
    days: list[date] = []
    day = now.date()
    while len(days) < count:
        day += timedelta(days=1)
        if day.weekday() < 5:
            days.append(day)
    return days


def open_clinic(now: datetime) -> Clinic:
    """The live practice: the standing roster, a rolling schedule, and a few visits on the books."""
    weekday = upcoming_weekdays(now, 3)
    booked = [
        {
            "id": "APT2001",
            "chart_id": "MRN10003",
            "provider_id": "chen",
            "start": datetime.combine(weekday[1], time(14, 30)).isoformat(),
            "visit_type": "follow_up",
            "reason": "knee recheck",
        },
        {
            "id": "APT2002",
            "chart_id": "MRN10004",
            "provider_id": "whitfield",
            "start": datetime.combine(weekday[0], time(11, 30)).isoformat(),
            "visit_type": "follow_up",
            "reason": "blood pressure recheck",
        },
        {
            "id": "APT2003",
            "chart_id": "MRN10002",
            "provider_id": "raman",
            "start": datetime.combine(weekday[2], time(9, 30)).isoformat(),
            "visit_type": "well_child",
            "reason": "yearly check-up",
        },
    ]
    return Clinic(
        now=now,
        providers=list(PROVIDERS),
        patients=_patients(ROSTER),
        slots=rolling_slots(now),
        appointments=_appointments(booked),
    )
