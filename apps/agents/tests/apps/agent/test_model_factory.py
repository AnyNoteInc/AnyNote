from unittest.mock import MagicMock, patch

import pytest
from agents.apps.agent.enums_shared import ModelProviderEnum
from agents.apps.agent.errors_shared import InvalidPayloadError
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.schemas import ModelConfigSchema
from pydantic import SecretStr


def _config(provider: ModelProviderEnum, connection: dict[str, object] | None = None) -> ModelConfigSchema:
    return ModelConfigSchema(**{'provider': provider, 'name': 'm', 'connection': connection or {}})


def test_make_gigachat_requires_credentials() -> None:
    with pytest.raises(InvalidPayloadError, match='GigaChat'):
        ModelFactoryRepository.make(_config(ModelProviderEnum.GIGACHAT, {'clientId': 'cid'}))


def test_make_anthropic_requires_api_key() -> None:
    with pytest.raises(InvalidPayloadError, match='Anthropic'):
        ModelFactoryRepository.make(_config(ModelProviderEnum.ANTHROPIC))


def test_make_anthropic_passes_api_key() -> None:
    with patch('agents.apps.agent.repositories.model_factory.ChatAnthropic') as mock_cls:
        mock_cls.return_value = MagicMock()
        ModelFactoryRepository.make(_config(ModelProviderEnum.ANTHROPIC, {'apiKey': 'sk-ant'}))
        kwargs = mock_cls.call_args.kwargs
        assert kwargs['model'] == 'm'
        assert isinstance(kwargs['api_key'], SecretStr)
        assert kwargs['api_key'].get_secret_value() == 'sk-ant'
        assert kwargs['base_url'] is None


def test_make_deepseek_requires_api_key() -> None:
    with pytest.raises(InvalidPayloadError, match='DeepSeek'):
        ModelFactoryRepository.make(_config(ModelProviderEnum.DEEPSEEK))


def test_make_deepseek_uses_openai_compatible_client() -> None:
    with patch('agents.apps.agent.repositories.model_factory.ChatOpenAI') as mock_cls:
        mock_cls.return_value = MagicMock()
        ModelFactoryRepository.make(_config(ModelProviderEnum.DEEPSEEK, {'apiKey': 'sk-ds'}))
        kwargs = mock_cls.call_args.kwargs
        assert kwargs['model'] == 'm'
        assert kwargs['base_url'] == 'https://api.deepseek.com'
        assert kwargs['api_key'].get_secret_value() == 'sk-ds'


def test_make_yandexgpt_requires_api_key_and_folder() -> None:
    with pytest.raises(InvalidPayloadError, match='YandexGPT'):
        ModelFactoryRepository.make(_config(ModelProviderEnum.YANDEXGPT, {'apiKey': 'k'}))


def test_make_yandexgpt_passes_credentials() -> None:
    with patch('agents.apps.agent.repositories.model_factory.ChatYandexGPT') as mock_cls:
        mock_cls.return_value = MagicMock()
        ModelFactoryRepository.make(_config(ModelProviderEnum.YANDEXGPT, {'apiKey': 'k', 'folderId': 'b1g'}))
        kwargs = mock_cls.call_args.kwargs
        assert kwargs['folder_id'] == 'b1g'
        assert kwargs['model_name'] == 'm'
        assert isinstance(kwargs['api_key'], SecretStr)
        assert kwargs['api_key'].get_secret_value() == 'k'
