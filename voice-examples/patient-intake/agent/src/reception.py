"""The Maplewood receptionist and its complete tool surface."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal

from livekit.agents import Agent, ToolError, function_tool

from clinic import (
    Clinic,
    Insurance,
    MessageKind,
    Patient,
    PatientAgeGroup,
    ProviderEligibilityError,
    RecordNotFoundError,
    Slot,
    SlotUnavailableError,
    VisitType,
)
from knowledge import PracticeInfo
from prompts import instructions, prompt

PatientStatus = Literal["new", "established"]
ProviderChoice = Literal["any", "alvarez", "chen", "raman", "whitfield"]
TimeOfDay = Literal["any", "morning", "afternoon"]
AppointmentAction = Literal["list", "cancel", "reschedule"]
CallerRelationship = Literal["the patient", "parent or guardian", "someone else"]


def _date(value: str, *, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ToolError(f"{field} must be a real date in YYYY-MM-DD format") from error


def _clock(value: datetime | time) -> str:
    """Speak a time without a leading zero, on every platform."""
    return f"{value.hour % 12 or 12}:{value:%M %p}"


def _when(value: datetime) -> str:
    return f"{value:%A, %B} {value.day} at {_clock(value)}"


def _day(value: date) -> str:
    return f"{value:%A, %B} {value.day}"


def _time(value: str) -> time:
    try:
        return time.fromisoformat(value)
    except ValueError as error:
        raise ToolError("preferred_time must be a real time in HH:MM format") from error


def _slot_line(clinic: Clinic, slot: Slot) -> str:
    return (
        f"{slot.id}: {_when(slot.start)} with {clinic.provider(slot.provider_id).name}"
    )


def _message_policy(kind: MessageKind) -> str:
    return {
        "prescription_refill": (
            "The front desk cannot approve or send a refill. The nurse will review "
            "it, and routine requests are processed within two business days."
        ),
        "test_results": (
            "Only the provider or nurse can discuss results; this asks them to call. "
            "No callback time is promised."
        ),
        "billing": "Billing returns calls within two business days.",
        "referral": (
            "The provider decides the referral and responds within three business days."
        ),
        "medical_records": (
            "A signed release is required and records can take ten business days."
        ),
        "nurse_callback": "The request is waiting for nurse review.",
    }[kind]


class PatientIntakeAgent(Agent):
    """One receptionist with one conversation and a fixed set of typed tools."""

    def __init__(self, *, clinic: Clinic, greet: bool = True) -> None:
        super().__init__(
            instructions=instructions("voice", "reception", now=clinic.now)
        )
        self.clinic = clinic
        self.practice_info: PracticeInfo = PracticeInfo()
        self._greet = greet

    async def on_enter(self) -> None:
        if self._greet:
            await self.session.generate_reply(instructions=prompt("greeting"))

    def _patient(self, last_name: str, date_of_birth: str) -> Patient:
        try:
            return self.clinic.find_patient(
                last_name, _date(date_of_birth, field="date_of_birth")
            )
        except RecordNotFoundError as error:
            raise ToolError(
                "No patient matched that last name and date of birth. Ask the caller "
                "to check those two details. Do not guess and do not create a chart "
                "unless the caller has said they are new to the practice."
            ) from error

    @function_tool
    async def read_practice_information(self) -> str:
        """Read the practice's complete published guide before answering policy questions.

        Use this for hours, location, parking, insurance, billing, visit preparation,
        refills, results, referrals, privacy, accessibility, or after-hours care.
        """
        return str(self.practice_info.guide())

    @function_tool
    async def find_open_times(
        self,
        patient_status: PatientStatus,
        date_of_birth: str,
        last_name: str,
        provider_id: ProviderChoice = "any",
        preferred_date: str = "",
        time_of_day: TimeOfDay = "any",
        preferred_time: str = "",
    ) -> str:
        """Find real appointment openings that are suitable for the patient.

        Call this only after the caller has given the patient's real surname and date
        of birth. Repeat it whenever the caller changes the requested date, time of
        day, or provider. Offer only the returned times. The slot IDs are for later
        tool calls and must never be spoken aloud.

        Args:
            patient_status: Whether the caller said this is a new or returning patient.
            date_of_birth: Patient's full birth date in YYYY-MM-DD format.
            last_name: Patient's family name or surname. Ask if only a first name is
                known; never reuse the first name or pass a placeholder.
            provider_id: Requested provider, or any when there is no preference.
            preferred_date: Exact requested date in YYYY-MM-DD, or empty for any date.
            time_of_day: Requested part of the day; afternoon begins at noon.
            preferred_time: Exact requested time in HH:MM, or empty for any time.
        """
        born = _date(date_of_birth, field="date_of_birth")
        if patient_status == "established":
            self._patient(last_name, date_of_birth)
        on_date = (
            _date(preferred_date, field="preferred_date") if preferred_date else None
        )
        requested_provider = "" if provider_id == "any" else provider_id
        exact_time = _time(preferred_time) if preferred_time else None

        try:
            if requested_provider:
                self.clinic.provider(requested_provider)
        except RecordNotFoundError as error:
            raise ToolError(f"There is no provider named {provider_id!r}") from error

        def eligible(slot: Slot, *, include_exact_time: bool = True) -> bool:
            provider = self.clinic.provider(slot.provider_id)
            age = (
                slot.start.year
                - born.year
                - ((slot.start.month, slot.start.day) < (born.month, born.day))
            )
            age_ok = provider.panel.accepts(
                PatientAgeGroup.CHILD if age < 18 else PatientAgeGroup.ADULT
            )
            status_ok = (
                patient_status == "established" or provider.accepting_new_patients
            )
            time_ok = (
                time_of_day == "any"
                or (time_of_day == "morning" and slot.start.hour < 12)
                or (time_of_day == "afternoon" and slot.start.hour >= 12)
            )
            exact_time_ok = (
                not include_exact_time
                or exact_time is None
                or (
                    slot.start.hour,
                    slot.start.minute,
                )
                == (exact_time.hour, exact_time.minute)
            )
            return age_ok and status_ok and time_ok and exact_time_ok

        slots = [
            slot
            for slot in self.clinic.open_slots(
                provider_id=requested_provider, on_date=on_date
            )
            if eligible(slot)
        ]
        if not slots and requested_provider:
            provider = self.clinic.provider(requested_provider)
            age = (
                self.clinic.now.year
                - born.year
                - (
                    (self.clinic.now.month, self.clinic.now.day)
                    < (born.month, born.day)
                )
            )
            age_group = PatientAgeGroup.CHILD if age < 18 else PatientAgeGroup.ADULT
            if not provider.panel.accepts(age_group):
                alternatives = [
                    slot for slot in self.clinic.open_slots() if eligible(slot)
                ][:3]
                answer = (
                    f"{provider.name} does not see patients in this age group. "
                    "Patients under 18 are seen by Doctor Priya Raman."
                )
                if alternatives:
                    answer += " Available alternatives:\n" + "\n".join(
                        _slot_line(self.clinic, slot) for slot in alternatives
                    )
                return answer
            if patient_status == "new" and not provider.accepting_new_patients:
                alternatives = [
                    slot
                    for slot in self.clinic.open_slots(on_date=on_date)
                    if eligible(slot)
                ][:3]
                answer = f"{provider.name} is not accepting new patients."
                if alternatives:
                    answer += " Available alternatives:\n" + "\n".join(
                        _slot_line(self.clinic, slot) for slot in alternatives
                    )
                return answer
        if not slots and exact_time:
            alternatives = [
                slot
                for slot in self.clinic.open_slots(
                    provider_id=requested_provider, on_date=on_date
                )
                if eligible(slot, include_exact_time=False)
            ][:3]
            date_phrase = f" on {_day(on_date)}" if on_date else ""
            answer = (
                f"No suitable appointment is open at {_clock(exact_time)}{date_phrase}."
            )
            if alternatives:
                answer += " Next available times:\n" + "\n".join(
                    _slot_line(self.clinic, slot) for slot in alternatives
                )
            return answer
        if not slots:
            requested = f" on {_day(on_date)}" if on_date else ""
            requested += " in the morning" if time_of_day == "morning" else ""
            requested += " in the afternoon" if time_of_day == "afternoon" else ""
            if requested:
                return f"No suitable appointments are open{requested}."
            return (
                "No suitable appointments are open anywhere in the next 60 days. "
                "There is no waitlist or notification message. Tell the caller to "
                "call back later because same-day openings are released each morning."
            )
        return "Open appointments:\n" + "\n".join(
            _slot_line(self.clinic, slot) for slot in slots[:3]
        )

    @function_tool
    async def book_appointment(
        self,
        patient_status: PatientStatus,
        last_name: str,
        date_of_birth: str,
        slot_id: str,
        visit_type: VisitType,
        reason: str,
        first_name: str = "",
        phone: str = "",
    ) -> str:
        """Book the exact opening the caller chose and register a new patient if needed.

        A caller who said they have never been to the practice has already asked to be
        registered by asking for an appointment. Use patient_status=new and provide
        their first name; do not ask separately whether they want a chart. Call this
        only after the caller chooses a time returned by find_open_times.

        Args:
            patient_status: Whether the caller said this is a new or returning patient.
            last_name: Patient's last name.
            date_of_birth: Patient's full birth date in YYYY-MM-DD format.
            slot_id: Exact unspoken slot ID returned by find_open_times.
            visit_type: The visit category that matches the caller's request.
            reason: Brief factual reason for the visit, without diagnosis.
            first_name: Patient's first name; required for a genuinely new patient.
            phone: Callback number if the new patient supplied one, otherwise empty.
        """
        born = _date(date_of_birth, field="date_of_birth")
        try:
            patient = self.clinic.find_patient(last_name, born)
        except RecordNotFoundError:
            if patient_status != "new":
                raise ToolError(
                    "No patient matched that last name and date of birth. Ask the "
                    "caller to check both details before trying again. If they then "
                    "confirm they are new, retry with patient_status=new."
                ) from None
            if not first_name.strip():
                raise ToolError(
                    "first_name is required to register a new patient"
                ) from None
            try:
                slot = self.clinic.slot(slot_id)
                provider = self.clinic.provider(slot.provider_id)
            except (RecordNotFoundError, SlotUnavailableError) as error:
                raise ToolError(
                    "That opening is no longer available. Call find_open_times again."
                ) from error
            age = (
                slot.start.year
                - born.year
                - ((slot.start.month, slot.start.day) < (born.month, born.day))
            )
            age_group = PatientAgeGroup.CHILD if age < 18 else PatientAgeGroup.ADULT
            if not provider.accepting_new_patients or not provider.panel.accepts(
                age_group
            ):
                raise ToolError(
                    f"{provider.name} cannot accept this new patient. Call "
                    "find_open_times again without that provider."
                ) from None
            patient = self.clinic.register_patient(
                first_name=first_name,
                last_name=last_name,
                date_of_birth=born,
                phone=phone or "",
            )

        try:
            appointment = self.clinic.book(
                patient=patient,
                slot_id=slot_id,
                visit_type=visit_type,
                reason=reason,
            )
        except SlotUnavailableError as error:
            raise ToolError(
                "That opening is no longer available. Call find_open_times again."
            ) from error
        except ProviderEligibilityError as error:
            raise ToolError(str(error)) from error

        provider = self.clinic.provider(appointment.provider_id)
        return f"Booked {_when(appointment.start)} with {provider.name}."

    @function_tool
    async def manage_appointment(
        self,
        action: AppointmentAction,
        last_name: str,
        date_of_birth: str,
        caller_relationship: CallerRelationship,
        appointment_id: str = "",
        new_slot_id: str = "",
    ) -> str:
        """List, cancel, or reschedule an established patient's appointments.

        Use list first when the appointment ID is not already known. A list may be
        disclosed only to the patient or a parent or guardian. Anyone with the exact
        identity may cancel or reschedule on the patient's behalf. Never speak an
        appointment or slot ID aloud.

        Args:
            action: The operation the caller explicitly requested.
            last_name: Patient's last name.
            date_of_birth: Patient's full birth date in YYYY-MM-DD format.
            caller_relationship: Who the caller says they are to the patient.
            appointment_id: Existing appointment ID, required to cancel or reschedule.
            new_slot_id: New slot ID from find_open_times, required to reschedule.
        """
        patient = self._patient(last_name, date_of_birth)
        if action == "list":
            if caller_relationship == "someone else":
                return (
                    "Do not confirm whether this person has an appointment. Explain "
                    "that the patient must call or authorize access in writing."
                )
            appointments = self.clinic.scheduled_for(patient.chart_id)
            if not appointments:
                return "No upcoming appointments are scheduled."
            return "Upcoming appointments:\n" + "\n".join(
                f"{appointment.id}: {_when(appointment.start)} with "
                f"{self.clinic.provider(appointment.provider_id).name}"
                for appointment in appointments
            )

        if not appointment_id:
            raise ToolError("appointment_id is required; call manage_appointment=list")
        try:
            appointment = self.clinic.appointment(appointment_id)
        except RecordNotFoundError as error:
            raise ToolError(
                "That appointment ID does not exist. List appointments again."
            ) from error
        if appointment.chart_id != patient.chart_id:
            raise ToolError("That appointment does not belong to this patient")

        try:
            if action == "cancel":
                cancelled = self.clinic.cancel(appointment_id)
                return f"Cancelled the appointment on {_when(cancelled.start)}."
            if not new_slot_id:
                raise ToolError(
                    "new_slot_id is required; call find_open_times before rescheduling"
                )
            moved = self.clinic.reschedule(appointment_id, new_slot_id)
        except (RecordNotFoundError, SlotUnavailableError) as error:
            raise ToolError(
                "The appointment or opening is no longer available. List appointments "
                "or find open times again."
            ) from error
        except ProviderEligibilityError as error:
            raise ToolError(str(error)) from error
        provider = self.clinic.provider(moved.provider_id)
        return f"Rescheduled to {_when(moved.start)} with {provider.name}."

    @function_tool
    async def take_message(
        self,
        last_name: str,
        date_of_birth: str,
        kind: MessageKind,
        summary: str,
        callback_phone: str = "",
    ) -> str:
        """Route one chart message to the appropriate practice team.

        Use this for prescription refills, test results, billing, referrals, nurse
        callbacks, or medical records. This records a request; it never means the
        request was clinically approved or completed. After it succeeds, state what
        was routed in one sentence and yield without a follow-up question.

        Args:
            last_name: Patient's last name.
            date_of_birth: Patient's full birth date in YYYY-MM-DD format.
            kind: The team queue that matches the request.
            summary: A short factual summary of what the caller asked for.
            callback_phone: Number supplied for a callback, or empty to use the chart.
        """
        patient = self._patient(last_name, date_of_birth)
        if self.clinic.message_for(kind=kind, chart_id=patient.chart_id):
            return (
                f"That {kind.replace('_', ' ')} request was already routed. No second "
                f"message was sent. {_message_policy(kind)}"
            )
        self.clinic.take_message(
            kind=kind,
            chart_id=patient.chart_id,
            summary=summary,
            callback_phone=callback_phone or patient.phone,
        )
        return f"Routed the {kind.replace('_', ' ')} request. {_message_policy(kind)}"

    @function_tool
    async def update_insurance(
        self,
        last_name: str,
        date_of_birth: str,
        carrier: str,
        member_id: str,
        group_number: str = "",
    ) -> str:
        """Replace the insurance on an established patient's chart from their card.

        After it succeeds, state that the insurance was updated in one sentence and
        yield without a follow-up question.

        Args:
            last_name: Patient's last name.
            date_of_birth: Patient's full birth date in YYYY-MM-DD format.
            carrier: Insurance company exactly as read from the current card.
            member_id: Member ID exactly as read from the current card.
            group_number: Group number if the card has one, otherwise empty.
        """
        patient = self._patient(last_name, date_of_birth)
        self.clinic.record_insurance(
            patient,
            Insurance(
                carrier=carrier.strip(),
                member_id=member_id.strip(),
                group_number=group_number.strip(),
            ),
        )
        return f"Updated the insurance to {carrier.strip()}."

    @function_tool
    async def record_previsit_intake(
        self,
        last_name: str,
        date_of_birth: str,
        chief_complaint: str,
        symptom_duration: str,
        medications: list[str],
        allergies: list[str],
        conditions: list[str],
        pharmacy: str,
    ) -> str:
        """Save the completed pre-visit answers for an established patient.

        Collect the answers conversationally, one question at a time, then call this
        once with the caller's own answers. Use an empty list when the caller explicitly
        says none. Do not diagnose, interpret, normalize, or invent details.

        Args:
            last_name: Patient's last name.
            date_of_birth: Patient's full birth date in YYYY-MM-DD format.
            chief_complaint: Caller-described reason for the visit.
            symptom_duration: Caller-described duration, or not applicable.
            medications: Every medication or supplement the caller named.
            allergies: Every allergy and reaction named by the caller.
            conditions: Ongoing conditions the caller named.
            pharmacy: Preferred pharmacy, or none if the caller has no pharmacy.
        """
        patient = self._patient(last_name, date_of_birth)
        record = self.clinic.intake_for(patient.chart_id)
        record.chief_complaint = chief_complaint.strip()
        record.symptom_duration = symptom_duration.strip()
        record.medications = medications
        record.allergies = allergies
        record.conditions = conditions
        record.pharmacy = pharmacy.strip()
        record.complete()
        return "Saved the pre-visit answers."

    @function_tool
    async def record_emergency_escalation(self, reported_symptoms: str) -> str:
        """Record that the caller explicitly reported a possible emergency.

        Use the caller's meaning and the safety instructions, not keywords. Do not call
        this for an ordinary symptom without an emergency concern. After calling it,
        give the appropriate emergency direction from the instructions and stop all
        ordinary front-desk work.

        Args:
            reported_symptoms: Briefly preserve what the caller actually reported.
        """
        self.clinic.escalate(chart_id="", symptoms=reported_symptoms)
        return "Emergency escalation recorded. Give the appropriate direction now."


__all__ = ["PatientIntakeAgent"]
