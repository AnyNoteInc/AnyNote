from agents.apps.agent.events import ServerEvent


def test_token_event_serializes() -> None:
    e = ServerEvent.token('hello')
    payload = e.model_dump(mode='json')
    assert payload['type'] == 'token'
    assert payload['text'] == 'hello'
    assert payload['step_id'] is None


def test_confirmation_required_round_trips() -> None:
    e = ServerEvent.confirmation_required(
        confirmation_id='cid-1',
        tool='anynote__createPage',
        summary='Создать страницу X',
        args_preview={'title': 'X'},
    )
    payload = e.model_dump(mode='json')
    assert payload['type'] == 'confirmation_required'
    assert payload['confirmation_id'] == 'cid-1'


def test_plan_step_with_status() -> None:
    e = ServerEvent.plan_step(id='1', title='Найти страницы', position=0, status='pending')
    payload = e.model_dump(mode='json')
    assert payload['status'] == 'pending'
    assert payload['position'] == 0


def test_done_terminator() -> None:
    e = ServerEvent.done()
    assert e.model_dump(mode='json')['type'] == 'done'


def test_error_with_recoverable_flag() -> None:
    e = ServerEvent.error('PROVIDER_ERROR', 'OpenAI down', recoverable=True)
    payload = e.model_dump(mode='json')
    assert payload['recoverable'] is True
