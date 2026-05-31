from agents.apps.agent.schemas import ServerEventSchema


def test_thinking_event_serializes() -> None:
    ev = ServerEventSchema(type='thinking', text='let me think')
    data = ev.model_dump_json(exclude_none=True)
    assert '"type":"thinking"' in data
    assert 'let me think' in data
