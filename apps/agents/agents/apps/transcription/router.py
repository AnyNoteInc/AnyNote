"""Transcription + meeting-summarize routes — internal service-token tier.

Both endpoints mirror validation/router.py: gated by verify_agents_service_token
(signature + audience only, NOT the chat JWT) and resolve their use case from the
dishka container.
"""

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends

from agents.apps.agent.guards import verify_agents_service_token

from .schemas import (
    SummarizeRequestSchema,
    SummarizeResponseSchema,
    TranscribeRequestSchema,
    TranscribeResponseSchema,
)
from .use_cases import SummarizeUseCase, TranscribeUseCase

router = APIRouter(tags=['Transcription'])


@router.post('/transcription', dependencies=[Depends(verify_agents_service_token)])
@inject
async def transcribe(
    payload: TranscribeRequestSchema,
    use_case: FromDishka[TranscribeUseCase],
) -> TranscribeResponseSchema:
    return await use_case(payload)


@router.post('/meeting/summarize', dependencies=[Depends(verify_agents_service_token)])
@inject
async def summarize_meeting(
    payload: SummarizeRequestSchema,
    use_case: FromDishka[SummarizeUseCase],
) -> SummarizeResponseSchema:
    return await use_case(payload)
