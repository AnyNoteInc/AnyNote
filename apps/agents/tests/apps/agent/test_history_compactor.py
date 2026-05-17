from agents.apps.agent.enums_shared import RoleEnum
from agents.apps.agent.schemas import ConversationMessageSchema
from agents.apps.agent.services.history_compactor import trim_chat_history


def msg(i: int) -> ConversationMessageSchema:
    return ConversationMessageSchema(role=RoleEnum.USER, content=f'm{i}')


def test_returns_input_when_under_limit() -> None:
    history = [msg(i) for i in range(10)]
    assert trim_chat_history(history, max_messages=30) == history


def test_keeps_first_five_and_last_fifteen_with_placeholder() -> None:
    history = [msg(i) for i in range(40)]
    out = trim_chat_history(history, max_messages=30)
    assert len(out) == 21
    assert [m.content for m in out[:5]] == [f'm{i}' for i in range(5)]
    assert out[5].content == '[earlier messages omitted for length]'
    assert [m.content for m in out[6:]] == [f'm{i}' for i in range(25, 40)]
