from __future__ import annotations

from agents.apps.chat.enums import RoleEnum
from agents.apps.chat.schemas import ConversationMessageSchema


def trim_chat_history(
    history: list[ConversationMessageSchema],
    max_messages: int = 30,
) -> list[ConversationMessageSchema]:
    if len(history) <= max_messages:
        return history
    head = history[:5]
    tail = history[-15:]
    placeholder = ConversationMessageSchema(
        role=RoleEnum.USER,
        content='[earlier messages omitted for length]',
    )
    return [*head, placeholder, *tail]
