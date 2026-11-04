"""Compose and run the xAI patient-intake agent."""

from __future__ import annotations

import logging
from datetime import datetime

from dotenv import load_dotenv
from livekit.agents import (
    AgentServer,
    AgentSession,
    ExpressiveOptions,
    JobContext,
    TurnHandlingOptions,
    cli,
    inference,
    room_io,
)
from livekit.plugins import ai_coustics

from clinic import open_clinic
from prompts import prompt
from reception import PatientIntakeAgent
from visit import Visit

logger = logging.getLogger("xai-patient-intake")

server = AgentServer()


async def on_session_end(ctx: JobContext) -> None:
    """Log which models the finished call used, and how much."""
    try:
        report = ctx.make_session_report()
    except RuntimeError as error:
        if "no AgentSession" not in str(error):
            logger.error("no usage report for this call: %s", error)
        return

    logger.info(
        "call finished",
        extra={
            "models": [usage.model for usage in report.model_usage or []],
            "usage": report.model_usage,
        },
    )


@server.rtc_session(
    agent_name="xai-patient-intake",
    on_session_end=on_session_end,
)
async def patient_intake(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}
    clinic = open_clinic(datetime.now())
    session = AgentSession[Visit](
        userdata=Visit(clinic=clinic),
        stt=inference.STT(model="xai/stt-1", language="en"),
        llm=inference.LLM(
            model="xai/grok-4.20-0309-non-reasoning",
            extra_kwargs={
                "temperature": 0.3,
                "max_completion_tokens": 600,
                "parallel_tool_calls": False,
            },
        ),
        # optimize_streaming_latency=1 trades a little quality for a faster first word.
        tts=inference.TTS(
            model="xai/tts-1",
            voice="carina",
            extra_kwargs={"optimize_streaming_latency": 1},
        ),
        expressive=ExpressiveOptions(tts_instructions_append=prompt("expressive")),
        vad=inference.VAD(),
        max_tool_steps=5,
        # Dynamic endpointing gives hesitant, incomplete speech time to continue.
        turn_handling=TurnHandlingOptions(
            turn_detection=inference.TurnDetector(),
            endpointing={"mode": "dynamic", "min_delay": 1.2, "max_delay": 4.0},
        ),
    )
    await session.start(
        agent=PatientIntakeAgent(clinic=clinic),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=ai_coustics.audio_enhancement(
                    model=ai_coustics.EnhancerModel.QUAIL_VF_S
                ),
            ),
        ),
    )
    await ctx.connect()


if __name__ == "__main__":
    load_dotenv(".env.local")
    cli.run_app(server)
