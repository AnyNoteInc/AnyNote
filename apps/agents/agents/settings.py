from typing import Annotated, Any

from fast_clean.schemas import BearerTokenAuthSchema
from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreServiceSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field, model_validator


def _build_host_url(data: dict[str, Any]) -> dict[str, Any]:
    """Synthesize HOST from HOST + PORT + PROTOCOL env vars if not already a full URL."""
    host = data.get('host')
    if isinstance(host, str) and '://' not in host:
        protocol = data.get('protocol', 'http')
        port = data.get('port', '')
        port_str = f':{port}' if port else ''
        data['host'] = f'{protocol}://{host}{port_str}'
    return data


class QdrantSettingsSchema(CoreServiceSettingsSchema):
    auth: BearerTokenAuthSchema | None = None
    collection_name: str = 'pages'
    vector_size: int = 768
    port: int | None = None
    protocol: str | None = None

    @model_validator(mode='before')
    @classmethod
    def construct_host_url(cls, data: dict[str, Any]) -> dict[str, Any]:
        return _build_host_url(data)

    @property
    def url(self) -> str:
        """Return the service URL."""
        return str(self.host).rstrip('/')


class OllamaSettingsSchema(CoreServiceSettingsSchema):
    embedding_model: str = 'nomic-embed-text'
    port: int | None = None
    protocol: str | None = None

    @model_validator(mode='before')
    @classmethod
    def construct_host_url(cls, data: dict[str, Any]) -> dict[str, Any]:
        return _build_host_url(data)

    @property
    def url(self) -> str:
        """Return the service URL."""
        return str(self.host).rstrip('/')


class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: QdrantSettingsSchema
    ollama: OllamaSettingsSchema


settings = SettingsSchema()
