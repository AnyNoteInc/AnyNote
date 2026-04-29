from agents.apps.chat.router import serialize_server_event
from agents.apps.chat.schemas import ServerEvent
from agents.bootstrap import create_app
from agents.router import apply_routes
from sse_starlette.event import ensure_bytes


def test_serialize_server_event_wraps_payload_as_json_sse_data() -> None:
    encoded = ensure_bytes(serialize_server_event(ServerEvent.token('hello')), sep='\n').decode()

    assert encoded == 'data: {"type":"token","text":"hello"}\n\n'


def test_openapi_builds_chat_generate_body_schema() -> None:
    app = create_app([apply_routes])

    schema = app.openapi()

    request_schema = schema['paths']['/chat/generate']['post']['requestBody']['content']['application/json']['schema']
    assert request_schema == {'$ref': '#/components/schemas/QueryRequestSchema'}

    components = schema['components']['schemas']
    query_schema = components['QueryRequestSchema']
    embedding_schema = query_schema['properties']['embedding']
    assert {'$ref': '#/components/schemas/EmbeddingProviderConfigSchema'} in embedding_schema['anyOf']

    embedding_component = components['EmbeddingProviderConfigSchema']
    assert embedding_component['properties']['modelSlug']['type'] == 'string'
    assert embedding_component['properties']['vectorSize']['type'] == 'integer'
    assert embedding_component['properties']['connection'] == {'$ref': '#/components/schemas/ModelConnectionSchema'}
