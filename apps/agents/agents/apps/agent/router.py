from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, Any

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sse_starlette.sse import EventSourceResponse

from .guards import verify_agents_jwt
from .schemas import AgentContext, AgentResumeRequestSchema, AgentRunRequestSchema, ServerEventSchema
from .use_cases import ResumeAgentUseCase, RunAgentUseCase
from .utils import extract_bearer_token

router = APIRouter(prefix='/agent', tags=['Agent'])


def _serialize(events: AsyncIterator[ServerEventSchema]) -> AsyncIterator[dict[str, Any]]:
    async def gen() -> AsyncIterator[dict[str, Any]]:
        async for ev in events:
            yield {'data': ev.model_dump_json(exclude_none=True)}
    return gen()


@router.post('/run', response_model=None, response_class=EventSourceResponse)
@inject
async def run(
    payload: AgentRunRequestSchema,
    authorization: Annotated[str, Header()],
    use_case: FromDishka[RunAgentUseCase],
    context: Annotated[AgentContext, Depends(verify_agents_jwt)],
) -> EventSourceResponse:
    if str(context.chat_id) != str(payload.chat_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat mismatch')
    jwt_token = extract_bearer_token(authorization) or ''
    return EventSourceResponse(
        _serialize(use_case(request=payload, context=context, jwt=jwt_token)),
        ping=15,
    )


@router.post('/resume', response_model=None, response_class=EventSourceResponse)
@inject
async def resume(
    payload: AgentResumeRequestSchema,
    authorization: Annotated[str, Header()],
    use_case: FromDishka[ResumeAgentUseCase],
    context: Annotated[AgentContext, Depends(verify_agents_jwt)],
) -> EventSourceResponse:
    if str(context.chat_id) != str(payload.chat_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat mismatch')
    jwt_token = extract_bearer_token(authorization) or ''
    return EventSourceResponse(
        _serialize(use_case(request=payload, context=context, jwt=jwt_token)),
        ping=15,
    )
