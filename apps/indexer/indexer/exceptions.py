"""Indexer exception hierarchy."""

from __future__ import annotations


class IndexerError(Exception):
    """Base error for the indexer service."""

    code: str = "INTERNAL_ERROR"


class EmbeddingsError(IndexerError):
    code = "EMBEDDINGS_ERROR"


class QdrantWriterError(IndexerError):
    code = "QDRANT_ERROR"


class OutboxClaimError(IndexerError):
    code = "OUTBOX_CLAIM_ERROR"


class HandlerError(IndexerError):
    code = "HANDLER_ERROR"
