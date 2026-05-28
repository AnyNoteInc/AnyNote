from base64 import b64encode
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from agents.apps.agent.enums_shared import ModelProviderEnum
from agents.apps.agent.errors_shared import InvalidPayloadError
from agents.apps.processing.repositories.embedding_factory import EmbeddingFactoryRepository
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema, ModelConnectionSchema
from pydantic import SecretStr


def _config(
    provider: ModelProviderEnum,
    connection: dict[str, object] | None = None,
) -> EmbeddingProviderConfigSchema:
    return EmbeddingProviderConfigSchema(**{
        'provider': provider,
        'modelSlug': 'm',
        'vectorSize': 768,
        'connection': connection or {},
    })


def test_make_ollama() -> None:
    factory = EmbeddingFactoryRepository()
    with patch('agents.apps.processing.repositories.embedding_factory.OllamaEmbeddings') as mock_emb:
        mock_emb.return_value = MagicMock()
        factory.make(_config(ModelProviderEnum.OLLAMA, {'baseUrl': 'http://o:1'}))
        mock_emb.assert_called_once_with(model='m', base_url='http://o:1')


def test_make_ollama_requires_base_url() -> None:
    factory = EmbeddingFactoryRepository()
    with pytest.raises(InvalidPayloadError, match='Ollama'):
        factory.make(_config(ModelProviderEnum.OLLAMA))


def test_make_openai_requires_api_key() -> None:
    factory = EmbeddingFactoryRepository()
    with pytest.raises(InvalidPayloadError, match='OpenAI'):
        factory.make(_config(ModelProviderEnum.OPENAI))


def test_make_openai_passes_api_key() -> None:
    factory = EmbeddingFactoryRepository()
    with patch('agents.apps.processing.repositories.embedding_factory.OpenAIEmbeddings') as mock_emb:
        mock_emb.return_value = MagicMock()
        factory.make(
            _config(
                ModelProviderEnum.OPENAI,
                {'apiKey': 'sk-x', 'organization': 'org', 'baseUrl': 'https://openai.example'},
            )
        )
        kwargs = mock_emb.call_args.kwargs
        assert kwargs['model'] == 'm'
        assert isinstance(kwargs['openai_api_key'], SecretStr)
        assert kwargs['openai_api_key'].get_secret_value() == 'sk-x'
        assert kwargs['openai_organization'] == 'org'
        assert kwargs['openai_api_base'] == 'https://openai.example'


def test_make_gigachat_b64_credentials() -> None:
    factory = EmbeddingFactoryRepository()
    with patch('agents.apps.processing.repositories.embedding_factory.GigaChatEmbeddings') as mock_emb:
        mock_emb.return_value = MagicMock()
        factory.make(
            _config(
                ModelProviderEnum.GIGACHAT,
                {
                    'clientId': 'cid',
                    'clientSecret': 'csec',
                    'scope': 'GIGACHAT_API_PERS',
                },
            )
        )
        kwargs = mock_emb.call_args.kwargs
        assert kwargs['credentials'] == b64encode(b'cid:csec').decode()
        assert kwargs['scope'] == 'GIGACHAT_API_PERS'
        assert kwargs['model'] == 'm'


@pytest.mark.parametrize(
    'connection',
    [
        {},
        {'clientId': 'cid'},
        {'clientSecret': 'csec'},
    ],
)
def test_make_gigachat_requires_credentials(connection: dict[str, object]) -> None:
    factory = EmbeddingFactoryRepository()
    with pytest.raises(InvalidPayloadError, match='GigaChat'):
        factory.make(_config(ModelProviderEnum.GIGACHAT, connection))


def test_make_unknown_provider_raises() -> None:
    factory = EmbeddingFactoryRepository()
    with pytest.raises(InvalidPayloadError, match='Unknown'):
        factory.make(
            EmbeddingProviderConfigSchema.model_construct(
                provider=cast(ModelProviderEnum, 'unknown'),
                model_slug='x',
                vector_size=1,
                connection=ModelConnectionSchema(),
            )
        )


def test_make_yandexgpt_requires_api_key_and_folder() -> None:
    factory = EmbeddingFactoryRepository()
    with pytest.raises(InvalidPayloadError, match='YandexGPT'):
        factory.make(_config(ModelProviderEnum.YANDEXGPT, {'apiKey': 'k'}))


def test_make_yandexgpt_passes_credentials() -> None:
    factory = EmbeddingFactoryRepository()
    with patch('agents.apps.processing.repositories.embedding_factory.YandexGPTEmbeddings') as mock_emb:
        mock_emb.return_value = MagicMock()
        factory.make(_config(ModelProviderEnum.YANDEXGPT, {'apiKey': 'k', 'folderId': 'b1g'}))
        kwargs = mock_emb.call_args.kwargs
        assert kwargs['folder_id'] == 'b1g'
        assert kwargs['model_name'] == 'm'
        assert isinstance(kwargs['api_key'], SecretStr)
        assert kwargs['api_key'].get_secret_value() == 'k'
