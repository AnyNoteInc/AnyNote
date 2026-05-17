from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AgentContext(BaseModel):
    user_id: UUID
    workspace_id: UUID
    chat_id: UUID
    scopes: frozenset[str]
    allow_destructive: bool = False

    model_config = ConfigDict(frozen=True)
