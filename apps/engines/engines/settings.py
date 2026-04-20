"""Pydantic settings for the engines MCP server."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        populate_by_name=True,
        extra="ignore",
    )

    engines_database_url: str = Field(alias="DATABASE_URL")
    engines_qdrant_url: str = Field(default="http://localhost:6333", alias="QDRANT_URL")
    engines_qdrant_api_key: str = Field(default="dev-qdrant-key", alias="QDRANT_API_KEY")
    engines_qdrant_collection: str = Field(default="anynote-pages", alias="QDRANT_COLLECTION")
    engines_mcp_token: str = Field(alias="ENGINES_MCP_TOKEN")

    embeddings_provider: str = Field(default="ollama", alias="EMBEDDINGS_PROVIDER")
    embeddings_model: str = Field(default="nomic-embed-text", alias="EMBEDDINGS_MODEL")
    embeddings_dim: int = Field(default=768, alias="EMBEDDINGS_DIM")
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")

    engines_log_level: str = Field(default="INFO", alias="ENGINES_LOG_LEVEL")
