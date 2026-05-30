from base64 import b64encode
from dataclasses import dataclass

from langchain_community.embeddings import YandexGPTEmbeddings
from langchain_core.embeddings import Embeddings
from langchain_gigachat.embeddings import GigaChatEmbeddings
from langchain_ollama import OllamaEmbeddings
from langchain_openai import OpenAIEmbeddings
from pydantic import SecretStr

from agents.apps.agent.enums import ModelProviderEnum
from agents.apps.agent.errors import InvalidPayloadError

from ..schemas import EmbeddingProviderConfigSchema


@dataclass
class EmbeddingFactoryRepository:

    @staticmethod
    def make(config: EmbeddingProviderConfigSchema) -> Embeddings:
        provider = str(config.provider)

        match provider:
            case ModelProviderEnum.OLLAMA:
                if config.connection.base_url is None:
                    raise InvalidPayloadError('Ollama provider requires base_url')
                return OllamaEmbeddings(model=config.model_slug, base_url=config.connection.base_url)

            case ModelProviderEnum.OPENAI:
                if config.connection.api_key is None:
                    raise InvalidPayloadError('OpenAI provider requires an api_key in the connection config')
                return OpenAIEmbeddings(
                    model=config.model_slug,
                    openai_api_key=SecretStr(config.connection.api_key),
                    openai_organization=config.connection.organization,
                    openai_api_base=config.connection.base_url,
                )

            case ModelProviderEnum.GIGACHAT:
                if config.connection.client_id is None or config.connection.client_secret is None:
                    raise InvalidPayloadError('GigaChat provider requires client_id and client_secret')
                credentials = b64encode(
                    f'{config.connection.client_id}:{config.connection.client_secret}'.encode()
                ).decode()
                return GigaChatEmbeddings(
                    credentials=credentials,
                    scope=config.connection.scope or 'GIGACHAT_API_PERS',
                    model=config.model_slug,
                    verify_ssl_certs=False,
                )
            case ModelProviderEnum.YANDEXGPT:
                if config.connection.api_key is None or config.connection.folder_id is None:
                    raise InvalidPayloadError('YandexGPT provider requires api_key and folder_id')
                # model_name sets the query embedding model; doc_model_name keeps its
                # default ("text-search-doc"), which is Yandex's matched query/doc pair
                # for the standard search embeddings. Don't force them equal.
                return YandexGPTEmbeddings(
                    api_key=SecretStr(config.connection.api_key),
                    folder_id=config.connection.folder_id,
                    model_name=config.model_slug,
                    grpc_metadata=[],  # overwritten by @pre_init validate_environment
                )

            case _:
                raise InvalidPayloadError(f'Unknown embedding provider: {provider!r}')
