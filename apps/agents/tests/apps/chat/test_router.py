import pytest
from agents.apps.chat.schemas import ServerEvent
from agents.apps.chat.utils import serialize_server_event
from sse_starlette.event import ensure_bytes


def test_serialize_server_event_wraps_payload_as_json_sse_data() -> None:
    encoded = ensure_bytes(serialize_server_event(ServerEvent.token('hello')), sep='\n').decode()

    assert encoded == 'data: {"type":"token","text":"hello"}\n\n'


@pytest.mark.legacy
def test_openapi_builds_chat_generate_body_schema() -> None:
    """Legacy: /chat/generate now returns 308; this schema test is no longer meaningful."""
    from agents.bootstrap import create_app
    from agents.router import apply_routes

    app = create_app([apply_routes])
    schema = app.openapi()

    # /chat/generate now returns 308 — no requestBody in schema.
    assert '/chat/generate' in schema['paths']
