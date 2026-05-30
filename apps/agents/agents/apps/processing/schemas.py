from typing import Annotated, Literal

from fast_clean.schemas.request_response import RequestResponseSchema
from pydantic import AliasChoices, ConfigDict, Field

from agents.apps.agent.enums import ModelProviderEnum


class BlockContentSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    block_number: int = Field(alias='blockNumber', ge=0)
    content: str = Field(min_length=1)

    @property
    def blockNumber(self) -> int:  # noqa: N802
        return self.block_number


class ModelConnectionSchema(RequestResponseSchema):
    # Checkpointed via LangGraph msgpack which always dumps with snake_case
    # field names — populate_by_name lets the restore path find values stored
    # under field names in addition to camelCase aliases.
    model_config = ConfigDict(populate_by_name=True)

    base_url: str | None = None
    api_key: str | None = None
    organization: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scope: str | None = None
    folder_id: str | None = None


class EmbeddingProviderConfigSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    provider: ModelProviderEnum
    model_slug: str = Field(alias='modelSlug', min_length=1)
    vector_size: int = Field(alias='vectorSize', ge=1)
    connection: ModelConnectionSchema


class VectorizationRequestSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    page_id: str = Field(alias='pageId')
    workspace_id: str = Field(alias='workspaceId')
    title: str
    page_type: str = Field(alias='pageType')
    contents: Annotated[list[BlockContentSchema], Field(default_factory=list)]
    embedding: EmbeddingProviderConfigSchema

    @property
    def pageId(self) -> str:  # noqa: N802
        return self.page_id

    @property
    def workspaceId(self) -> str:  # noqa: N802
        return self.workspace_id

    @property
    def pageType(self) -> str:  # noqa: N802
        return self.page_type


class VectorizationResponseSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal['ok'] = 'ok'
    chunks_indexed: int = Field(
        alias='chunksIndexed',
        validation_alias=AliasChoices('chunksIndexed', 'indexedChunks'),
    )
    skipped_blocks: int = Field(default=0, validation_alias='skippedBlocks', exclude=True)

    @property
    def indexedChunks(self) -> int:  # noqa: N802
        return self.chunks_indexed

    @property
    def skippedBlocks(self) -> int:  # noqa: N802
        return self.skipped_blocks


class WorkspaceWipeResponseSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    deleted_collections: list[str] = Field(default_factory=list, alias='deletedCollections')


class PageWipeResponseSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    deleted_collections: list[str] = Field(default_factory=list, alias='deletedCollections')


ContentBlockSchema = BlockContentSchema


class EmbeddingValidationRequestSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    provider: ModelProviderEnum
    model_slug: str = Field(alias='modelSlug', min_length=1)
    connection: ModelConnectionSchema


class EmbeddingValidationResponseSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    ok: bool
    vector_size: int | None = Field(default=None, alias='vectorSize')
    error: str | None = None
