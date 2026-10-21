"""The small in-memory clinic used by production and simulations."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Literal, get_args

VisitType = Literal[
    "sick_visit", "annual_physical", "well_child", "follow_up", "telehealth"
]
MessageKind = Literal[
    "prescription_refill",
    "test_results",
    "billing",
    "referral",
    "nurse_callback",
    "medical_records",
]
AppointmentStatus = Literal["scheduled", "cancelled"]

VISIT_TYPES = get_args(VisitType)
MESSAGE_KINDS = get_args(MessageKind)


class RecordNotFoundError(Exception):
    pass


class SlotUnavailableError(Exception):
    pass


class ProviderEligibilityError(Exception):
    pass


class PatientAgeGroup(str, Enum):
    CHILD = "under 18"
    ADULT = "18 or older"


class ProviderPanel(str, Enum):
    PEDIATRIC = "patients under 18"
    ADULT = "adults only"
    ALL_AGES = "children and adults"

    def accepts(self, age_group: PatientAgeGroup) -> bool:
        return (
            self is ProviderPanel.ALL_AGES
            or (self is ProviderPanel.PEDIATRIC and age_group is PatientAgeGroup.CHILD)
            or (self is ProviderPanel.ADULT and age_group is PatientAgeGroup.ADULT)
        )


class IntakeDisposition(str, Enum):
    NOT_STARTED = "not started"
    COMPLETED = "completed"


@dataclass(frozen=True, slots=True)
class Provider:
    id: str
    name: str
    specialty: str
    panel: ProviderPanel = ProviderPanel.ALL_AGES
    accepting_new_patients: bool = True


@dataclass(frozen=True, slots=True)
class Insurance:
    carrier: str
    member_id: str
    group_number: str = ""


@dataclass(slots=True)
class Patient:
    chart_id: str
    first_name: str
    last_name: str
    date_of_birth: date
    phone: str = ""
    primary_provider_id: str = ""
    insurance: Insurance | None = None
    registered_on_this_call: bool = False

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    def age_group_on(self, day: datetime) -> PatientAgeGroup:
        age = (
            day.year
            - self.date_of_birth.year
            - (
                (day.month, day.day)
                < (self.date_of_birth.month, self.date_of_birth.day)
            )
        )
        return PatientAgeGroup.CHILD if age < 18 else PatientAgeGroup.ADULT


@dataclass(frozen=True, slots=True)
class Slot:
    provider_id: str
    start: datetime

    @property
    def id(self) -> str:
        digest = hashlib.md5(
            f"{self.provider_id}{self.start.isoformat()}".encode()
        ).hexdigest()
        return f"SL{digest[:6].upper()}"


@dataclass(slots=True)
class Appointment:
    id: str
    chart_id: str
    provider_id: str
    start: datetime
    visit_type: VisitType
    reason: str = ""
    status: AppointmentStatus = "scheduled"

    @property
    def slot(self) -> Slot:
        return Slot(provider_id=self.provider_id, start=self.start)


@dataclass(slots=True)
class Message:
    id: str
    kind: MessageKind
    chart_id: str
    summary: str
    callback_phone: str = ""


@dataclass(slots=True)
class IntakeRecord:
    chart_id: str
    chief_complaint: str = ""
    symptom_duration: str = ""
    medications: list[str] | None = None
    allergies: list[str] | None = None
    conditions: list[str] | None = None
    pharmacy: str = ""
    disposition: IntakeDisposition = IntakeDisposition.NOT_STARTED

    def is_recorded(self, field_name: str) -> bool:
        value = getattr(self, field_name)
        return value is not None and value != ""

    def complete(self) -> None:
        self.disposition = IntakeDisposition.COMPLETED


@dataclass(slots=True)
class Escalation:
    chart_id: str
    symptoms: str


class Clinic:
    """Maplewood Family Medicine's records for the duration of one call."""

    def __init__(
        self,
        *,
        now: datetime,
        providers: list[Provider],
        patients: Sequence[Patient] = (),
        slots: Sequence[Slot] = (),
        appointments: Sequence[Appointment] = (),
    ) -> None:
        self.now = now
        self.providers = list(providers)
        self.patients = list(patients)
        self.appointments = list(appointments)
        self.messages: list[Message] = []
        self.intake_records: list[IntakeRecord] = []
        self.escalations: list[Escalation] = []
        self._open_slots = {slot.id: slot for slot in slots}
        for appointment in self.appointments:
            self._open_slots.pop(appointment.slot.id, None)
        self._next_id = 1

    def _issue(self, prefix: str) -> str:
        issued = f"{prefix}{self._next_id:04d}"
        self._next_id += 1
        return issued

    def provider(self, provider_id: str) -> Provider:
        for provider in self.providers:
            if provider.id == provider_id:
                return provider
        raise RecordNotFoundError(f"no provider {provider_id!r}")

    def find_patient(self, last_name: str, date_of_birth: date) -> Patient:
        for patient in self.patients:
            if (
                patient.last_name.casefold() == last_name.strip().casefold()
                and patient.date_of_birth == date_of_birth
            ):
                return patient
        raise RecordNotFoundError(f"no chart for {last_name} born {date_of_birth}")

    def register_patient(
        self,
        *,
        first_name: str,
        last_name: str,
        date_of_birth: date,
        phone: str = "",
    ) -> Patient:
        patient = Patient(
            chart_id=self._issue("MRN"),
            first_name=first_name.strip(),
            last_name=last_name.strip(),
            date_of_birth=date_of_birth,
            phone=phone,
            registered_on_this_call=True,
        )
        self.patients.append(patient)
        return patient

    def record_insurance(self, patient: Patient, insurance: Insurance) -> None:
        patient.insurance = insurance

    def open_slots(
        self,
        *,
        provider_id: str = "",
        on_date: date | None = None,
        within_days: int = 60,
    ) -> list[Slot]:
        horizon = self.now + timedelta(days=within_days)
        return sorted(
            (
                slot
                for slot in self._open_slots.values()
                if self.now < slot.start <= horizon
                and (not provider_id or slot.provider_id == provider_id)
                and (on_date is None or slot.start.date() == on_date)
            ),
            key=lambda slot: (slot.start, slot.provider_id),
        )

    def slot(self, slot_id: str) -> Slot:
        try:
            return self._open_slots[slot_id]
        except KeyError as error:
            raise SlotUnavailableError(f"slot {slot_id} is not available") from error

    def book(
        self, *, patient: Patient, slot_id: str, visit_type: VisitType, reason: str = ""
    ) -> Appointment:
        slot = self.slot(slot_id)
        self._require_eligible_provider(patient, slot)
        appointment = Appointment(
            id=self._issue("APT"),
            chart_id=patient.chart_id,
            provider_id=slot.provider_id,
            start=slot.start,
            visit_type=visit_type,
            reason=reason,
        )
        self._open_slots.pop(slot_id)
        self.appointments.append(appointment)
        return appointment

    def _require_eligible_provider(self, patient: Patient, slot: Slot) -> None:
        provider = self.provider(slot.provider_id)
        if not provider.panel.accepts(patient.age_group_on(slot.start)):
            raise ProviderEligibilityError(
                f"{provider.name} does not see patients in this age group"
            )
        if patient.registered_on_this_call and not provider.accepting_new_patients:
            raise ProviderEligibilityError(
                f"{provider.name} is not accepting new patients"
            )

    def appointment(self, appointment_id: str) -> Appointment:
        for appointment in self.appointments:
            if appointment.id == appointment_id:
                return appointment
        raise RecordNotFoundError(f"no appointment {appointment_id}")

    def scheduled_for(self, chart_id: str) -> list[Appointment]:
        return [
            appointment
            for appointment in self.appointments
            if appointment.chart_id == chart_id
            and appointment.status == "scheduled"
            and appointment.start > self.now
        ]

    def cancel(self, appointment_id: str) -> Appointment:
        appointment = self.appointment(appointment_id)
        if appointment.status != "scheduled":
            raise RecordNotFoundError(
                f"appointment {appointment_id} is already {appointment.status}"
            )
        appointment.status = "cancelled"
        self._open_slots[appointment.slot.id] = appointment.slot
        return appointment

    def reschedule(self, appointment_id: str, slot_id: str) -> Appointment:
        appointment = self.appointment(appointment_id)
        if appointment.status != "scheduled":
            raise RecordNotFoundError(
                f"appointment {appointment_id} is already {appointment.status}"
            )
        slot = self.slot(slot_id)
        self._require_eligible_provider(self.patient(appointment.chart_id), slot)
        previous_slot = appointment.slot
        self._open_slots.pop(slot_id)
        self._open_slots[previous_slot.id] = previous_slot
        appointment.provider_id = slot.provider_id
        appointment.start = slot.start
        return appointment

    def patient(self, chart_id: str) -> Patient:
        for patient in self.patients:
            if patient.chart_id == chart_id:
                return patient
        raise RecordNotFoundError(f"no chart {chart_id}")

    def message_for(self, *, kind: MessageKind, chart_id: str) -> Message | None:
        return next(
            (
                message
                for message in self.messages
                if message.kind == kind and message.chart_id == chart_id
            ),
            None,
        )

    def take_message(
        self,
        *,
        kind: MessageKind,
        chart_id: str,
        summary: str,
        callback_phone: str = "",
    ) -> Message:
        message = Message(
            id=self._issue("MSG"),
            kind=kind,
            chart_id=chart_id,
            summary=summary,
            callback_phone=callback_phone,
        )
        self.messages.append(message)
        return message

    def intake_for(self, chart_id: str) -> IntakeRecord:
        if record := self.intake_record(chart_id):
            return record
        record = IntakeRecord(chart_id=chart_id)
        self.intake_records.append(record)
        return record

    def intake_record(self, chart_id: str) -> IntakeRecord | None:
        return next(
            (record for record in self.intake_records if record.chart_id == chart_id),
            None,
        )

    def escalate(self, *, chart_id: str, symptoms: str) -> Escalation:
        escalation = Escalation(chart_id=chart_id, symptoms=symptoms)
        self.escalations.append(escalation)
        return escalation
