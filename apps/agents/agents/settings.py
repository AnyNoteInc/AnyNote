from typing import Annotated, Any

from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreServiceSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field, model_validator


class QdrantSettingsSchema(CoreServiceSettingsSchema):
    url: str
    collection_name: str = 'pages'
    vector_size: int = 768

    @model_validator(mode='before')
    @classmethod
    def populate_host_from_url(cls, data: Any) -> Any:
        """Parent class requires `host: HttpUrl`; we use `url` as the canonical field
        and copy it into `host` so HttpUrl validation runs against the same value."""
        if isinstance(data, dict) and 'url' in data and 'host' not in data:
            data['host'] = data['url']
        return data


class OllamaSettingsSchema(CoreServiceSettingsSchema):
    url: str
    embedding_model: str = 'nomic-embed-text'

    @model_validator(mode='before')
    @classmethod
    def populate_host_from_url(cls, data: Any) -> Any:
        if isinstance(data, dict) and 'url' in data and 'host' not in data:
            data['host'] = data['url']
        return data


class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: QdrantSettingsSchema
    ollama: OllamaSettingsSchema


settings = SettingsSchema()
