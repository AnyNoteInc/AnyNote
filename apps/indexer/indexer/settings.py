"""Pydantic settings for the indexer worker."""

from __future__ import annotations

import uuid

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        populate_by_name=True,
        extra="ignore",
    )

    indexer_database_url: str = Field(alias="INDEXER_DATABASE_URL")
    indexer_qdrant_url: str = Field(default="http://localhost:6333", alias="INDEXER_QDRANT_URL")
    indexer_qdrant_api_key: str = Field(default="dev-qdrant-key", alias="INDEXER_QDRANT_API_KEY")
    indexer_qdrant_collection: str = Field(
        default="anynote-pages", alias="INDEXER_QDRANT_COLLECTION"
    )
    indexer_poll_interval_ms: int = Field(default=1000, alias="INDEXER_POLL_INTERVAL_MS")
    indexer_batch: int = Field(default=16, alias="INDEXER_BATCH")
    indexer_lock_ttl_ms: int = Field(default=60_000, alias="INDEXER_LOCK_TTL_MS")
    indexer_max_attempts: int = Field(default=5, alias="INDEXER_MAX_ATTEMPTS")
    indexer_worker_id: str = Field(
        default_factory=lambda: f"indexer-{uuid.uuid4().hex[:12]}",
        alias="INDEXER_WORKER_ID",
    )
    indexer_log_level: str = Field(default="INFO", alias="INDEXER_LOG_LEVEL")

    embeddings_provider: str = Field(default="ollama", alias="EMBEDDINGS_PROVIDER")
    embeddings_model: str = Field(default="nomic-embed-text", alias="EMBEDDINGS_MODEL")
    embeddings_dim: int = Field(default=768, alias="EMBEDDINGS_DIM")

    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
