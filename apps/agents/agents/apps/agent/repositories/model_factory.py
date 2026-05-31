from base64 import b64encode
from dataclasses import dataclass

from langchain_anthropic import ChatAnthropic
from langchain_community.chat_models import ChatYandexGPT
from langchain_core.language_models import BaseChatModel
from langchain_gigachat.chat_models import GigaChat
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from agents.apps.agent.enums import ModelProviderEnum
from agents.apps.agent.errors import InvalidPayloadError
from agents.apps.agent.schemas import ModelConfigSchema, ReasoningConfigSchema

_ANTHROPIC_BUDGET = {'low': 1024, 'medium': 2000, 'high': 8000}


def build_reasoning_kwargs(config: ModelConfigSchema, reasoning: ReasoningConfigSchema) -> dict[str, object]:
    """Map the unified reasoning flag to the provider-specific constructor knob.

    OpenAI gets `reasoning={...}`, Anthropic gets `thinking={...}` (adaptive for
    Opus 4.6+ slugs, otherwise an explicit token budget). Providers that reason
    inherently (DeepSeek R1) or don't support a knob (GigaChat/Ollama/YandexGPT)
    return an empty mapping so the constructor call is unchanged.
    """
    if not reasoning.enabled:
        return {}
    provider = str(config.provider)
    if provider == ModelProviderEnum.OPENAI:
        return {'reasoning': {'effort': reasoning.effort, 'summary': 'auto'}}
    if provider == ModelProviderEnum.ANTHROPIC:
        if 'opus-4-6' in config.name or 'opus-4.6' in config.name:
            return {'thinking': {'type': 'adaptive'}}
        return {'thinking': {'type': 'enabled', 'budget_tokens': _ANTHROPIC_BUDGET[reasoning.effort]}}
    return {}


@dataclass
class ModelFactoryRepository:

    @staticmethod
    def make(config: ModelConfigSchema, reasoning: ReasoningConfigSchema | None = None) -> BaseChatModel:
        """Return a configured LangChain chat model for the requested provider."""
        settings = config.settings
        temperature = settings.temperature if settings.temperature is not None else 0.2
        provider = str(config.provider)
        extra = build_reasoning_kwargs(config, reasoning) if reasoning else {}

        match provider:
            case ModelProviderEnum.OLLAMA:
                base_url = config.connection.base_url
                return ChatOllama(model=config.name, base_url=base_url, temperature=temperature)

            case ModelProviderEnum.OPENAI:
                if config.connection.api_key is None:
                    raise InvalidPayloadError('OpenAI provider requires an api_key in the connection config')
                return ChatOpenAI(
                    model=config.name,
                    api_key=SecretStr(config.connection.api_key),
                    organization=config.connection.organization,
                    temperature=temperature,
                    **extra,
                )

            case ModelProviderEnum.GIGACHAT:
                if config.connection.client_id is None or config.connection.client_secret is None:
                    raise InvalidPayloadError('GigaChat provider requires client_id and client_secret')
                credentials = b64encode(
                    f'{config.connection.client_id}:{config.connection.client_secret}'.encode()
                ).decode()
                return GigaChat(
                    credentials=credentials,
                    scope=config.connection.scope or 'GIGACHAT_API_PERS',
                    model=config.name,
                    temperature=temperature,
                    verify_ssl_certs=False,
                    streaming=True,
                )

            case ModelProviderEnum.ANTHROPIC:
                if config.connection.api_key is None:
                    raise InvalidPayloadError('Anthropic provider requires an api_key in the connection config')
                return ChatAnthropic(
                    model=config.name,
                    api_key=SecretStr(config.connection.api_key),
                    base_url=config.connection.base_url,
                    temperature=temperature,
                    **extra,
                )

            case ModelProviderEnum.DEEPSEEK:
                if config.connection.api_key is None:
                    raise InvalidPayloadError('DeepSeek provider requires an api_key in the connection config')
                return ChatOpenAI(
                    model=config.name,
                    api_key=SecretStr(config.connection.api_key),
                    base_url=config.connection.base_url or 'https://api.deepseek.com',
                    temperature=temperature,
                )

            case ModelProviderEnum.YANDEXGPT:
                if config.connection.api_key is None or config.connection.folder_id is None:
                    raise InvalidPayloadError('YandexGPT provider requires api_key and folder_id')
                return ChatYandexGPT(
                    api_key=SecretStr(config.connection.api_key),
                    folder_id=config.connection.folder_id,
                    model_name=config.name,
                    temperature=temperature,
                )

            case _:
                raise InvalidPayloadError(f'Unknown provider: {provider!r}')
