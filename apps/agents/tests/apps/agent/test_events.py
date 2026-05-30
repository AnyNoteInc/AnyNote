from agents.apps.agent.schemas import ServerEventSchema


def test_token_event_serializes() -> None:
    e = ServerEventSchema.token('hello')
    payload = e.model_dump(mode='json')
    assert payload['type'] == 'token'
    assert payload['text'] == 'hello'
    assert payload['step_id'] is None


def test_confirmation_required_round_trips() -> None:
    e = ServerEventSchema.confirmation_required(
        confirmation_id='cid-1',
        tool='anynote__createPage',
        summary='Создать страницу X',
        args_preview={'title': 'X'},
    )
    payload = e.model_dump(mode='json')
    assert payload['type'] == 'confirmation_required'
    assert payload['confirmation_id'] == 'cid-1'


def test_plan_step_with_status() -> None:
    e = ServerEventSchema.plan_step(id='1', title='Найти страницы', position=0, status='pending')
    payload = e.model_dump(mode='json')
    assert payload['status'] == 'pending'
    assert payload['position'] == 0


def test_done_terminator() -> None:
    e = ServerEventSchema.done()
    assert e.model_dump(mode='json')['type'] == 'done'


def test_error_with_recoverable_flag() -> None:
    e = ServerEventSchema.error('PROVIDER_ERROR', 'OpenAI down', recoverable=True)
    payload = e.model_dump(mode='json')
    assert payload['recoverable'] is True
