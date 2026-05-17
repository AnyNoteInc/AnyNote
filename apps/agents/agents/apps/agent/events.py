from __future__ import annotations

from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel


EventType = Literal[
    'router_decision', 'plan_step', 'step_started', 'step_completed',
    'token', 'tool_status', 'confirmation_required',
    'memory_write_proposed', 'critic_verdict', 'citation',
    'usage', 'done', 'error',
]


class ServerEvent(BaseModel):
    type: EventType
    # union fields — only the subset for the given type is non-null
    text: str | None = None
    step_id: str | None = None
    id: str | None = None
    title: str | None = None
    position: int | None = None
    status: Literal['pending', 'running', 'done', 'failed', 'skipped'] | None = None
    tool: str | None = None
    state: Literal['running', 'done', 'error'] | None = None
    detail: str | None = None
    duration_ms: int | None = None
    confirmation_id: str | None = None
    summary: str | None = None
    args_preview: dict[str, Any] | None = None
    scope: Literal['workspace', 'user'] | None = None
    key: str | None = None
    content_preview: str | None = None
    verdict: Literal['approve', 'revise', 'reject'] | None = None
    feedback: str | None = None
    revision_count: int | None = None
    page_id: UUID | None = None
    workspace_id: UUID | None = None
    block_number: int | None = None
    quote: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None
    code: str | None = None
    message: str | None = None
    recoverable: bool | None = None
    kind: Literal['trivial', 'complex'] | None = None
    reason: str | None = None
    result_summary: str | None = None

    @classmethod
    def token(cls, text: str, step_id: str | None = None) -> Self:
        return cls(type='token', text=text, step_id=step_id)

    @classmethod
    def router_decision(cls, kind: Literal['trivial', 'complex'], reason: str) -> Self:
        return cls(type='router_decision', kind=kind, reason=reason)

    @classmethod
    def plan_step(
        cls,
        id: str,
        title: str,
        position: int,
        status: Literal['pending', 'running', 'done', 'failed', 'skipped'],
    ) -> Self:
        return cls(type='plan_step', id=id, title=title, position=position, status=status)

    @classmethod
    def step_started(cls, step_id: str) -> Self:
        return cls(type='step_started', step_id=step_id)

    @classmethod
    def step_completed(cls, step_id: str, result_summary: str) -> Self:
        return cls(type='step_completed', step_id=step_id, result_summary=result_summary)

    @classmethod
    def tool_status(
        cls,
        id: str,
        tool: str,
        state: Literal['running', 'done', 'error'],
        title: str,
        detail: str | None = None,
        duration_ms: int | None = None,
    ) -> Self:
        return cls(type='tool_status', id=id, tool=tool, state=state, title=title,
                   detail=detail, duration_ms=duration_ms)

    @classmethod
    def confirmation_required(
        cls,
        confirmation_id: str,
        tool: str,
        summary: str,
        args_preview: dict[str, Any],
    ) -> Self:
        return cls(type='confirmation_required', confirmation_id=confirmation_id,
                   tool=tool, summary=summary, args_preview=args_preview)

    @classmethod
    def memory_write_proposed(
        cls,
        scope: Literal['workspace', 'user'],
        key: str,
        content_preview: str,
    ) -> Self:
        return cls(type='memory_write_proposed', scope=scope, key=key,
                   content_preview=content_preview)

    @classmethod
    def critic_verdict(
        cls,
        verdict: Literal['approve', 'revise', 'reject'],
        feedback: str,
        revision_count: int,
    ) -> Self:
        return cls(type='critic_verdict', verdict=verdict, feedback=feedback,
                   revision_count=revision_count)

    @classmethod
    def citation(
        cls,
        page_id: UUID,
        workspace_id: UUID,
        block_number: int,
        title: str,
        quote: str | None = None,
    ) -> Self:
        return cls(type='citation', page_id=page_id, workspace_id=workspace_id,
                   block_number=block_number, title=title, quote=quote)

    @classmethod
    def usage(
        cls,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        cost_usd: float | None = None,
    ) -> Self:
        return cls(type='usage', prompt_tokens=prompt_tokens,
                   completion_tokens=completion_tokens,
                   total_tokens=total_tokens, cost_usd=cost_usd)

    @classmethod
    def done(cls) -> Self:
        return cls(type='done')

    @classmethod
    def error(cls, code: str, message: str, recoverable: bool = False) -> Self:
        return cls(type='error', code=code, message=message, recoverable=recoverable)
