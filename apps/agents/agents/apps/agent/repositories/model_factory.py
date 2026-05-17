from base64 import b64encode
from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel
from langchain_gigachat.chat_models import GigaChat
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from agents.apps.agent.enums_shared import ModelProviderEnum
from agents.apps.agent.errors_shared import InvalidPayloadError
from agents.apps.agent.schemas import ModelConfigSchema


@dataclass
class ModelFactoryRepository:

    @staticmethod
    def make(config: ModelConfigSchema) -> BaseChatModel:
        """Return a configured LangChain chat model for the requested provider."""
        settings = config.settings
        temperature = settings.temperature if settings.temperature is not None else 0.2
        provider = str(config.provider)

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
                )

            case ModelProviderEnum.GIGACHAT:
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
            case _:
                raise InvalidPayloadError(f'Unknown provider: {provider!r}')
