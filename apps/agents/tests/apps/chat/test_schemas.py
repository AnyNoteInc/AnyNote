from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.schemas import QueryRequestSchema
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema


def _query_request_payload() -> dict[str, object]:
    return {
        'threadId': '00000000-0000-0000-0000-000000000001',
        'model': {
            'provider': ModelProviderEnum.OLLAMA,
            'name': 'llama3.1',
        },
        'systemPrompt': '',
        'instruction': {
            'format': 'markdown',
            'language': 'ru',
            'citationsRequired': True,
        },
        'messages': [],
        'rag': None,
        'mcp': None,
        'query': 'test query',
    }


def test_query_request_embedding_defaults_to_none() -> None:
    payload = QueryRequestSchema.model_validate(_query_request_payload())

    assert payload.embedding is None


def test_query_request_parses_camel_case_embedding_payload() -> None:
    request_payload = _query_request_payload()
    request_payload['embedding'] = {
        'provider': ModelProviderEnum.OLLAMA,
        'modelSlug': 'nomic-embed-text',
        'vectorSize': 768,
        'connection': {
            'baseUrl': 'http://localhost:11434',
        },
    }

    payload = QueryRequestSchema.model_validate(request_payload)

    assert isinstance(payload.embedding, EmbeddingProviderConfigSchema)
    assert payload.embedding.provider == ModelProviderEnum.OLLAMA
    assert payload.embedding.model_slug == 'nomic-embed-text'
    assert payload.embedding.vector_size == 768
    assert payload.embedding.connection.base_url == 'http://localhost:11434'
