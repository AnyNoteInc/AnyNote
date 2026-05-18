from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, Any

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sse_starlette.sse import EventSourceResponse

from .depends import verify_agents_jwt
from .events import ServerEvent
from .schemas import AgentContext, AgentResumeRequest, AgentRunRequest
from .use_cases import ResumeAgentUseCase, RunAgentUseCase

router = APIRouter(prefix='/agent', tags=['Agent'])


def _serialize(events: AsyncIterator[ServerEvent]) -> AsyncIterator[dict[str, Any]]:
    async def gen() -> AsyncIterator[dict[str, Any]]:
        async for ev in events:
            yield {'data': ev.model_dump_json(exclude_none=True)}
    return gen()


@router.post('/run', response_model=None, response_class=EventSourceResponse)
@inject
async def run(
    payload: AgentRunRequest,
    authorization: Annotated[str, Header()],
    use_case: FromDishka[RunAgentUseCase],
    context: Annotated[AgentContext, Depends(verify_agents_jwt)],
) -> EventSourceResponse:
    if str(context.chat_id) != str(payload.chat_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat mismatch')
    jwt_token = authorization.split(' ', 1)[1]
    return EventSourceResponse(
        _serialize(use_case(request=payload, context=context, jwt=jwt_token)),
        ping=15,
    )


@router.post('/resume', response_model=None, response_class=EventSourceResponse)
@inject
async def resume(
    payload: AgentResumeRequest,
    authorization: Annotated[str, Header()],
    use_case: FromDishka[ResumeAgentUseCase],
    context: Annotated[AgentContext, Depends(verify_agents_jwt)],
) -> EventSourceResponse:
    if str(context.chat_id) != str(payload.chat_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat mismatch')
    jwt_token = authorization.split(' ', 1)[1]
    return EventSourceResponse(
        _serialize(use_case(request=payload, context=context, jwt=jwt_token)),
        ping=15,
    )
