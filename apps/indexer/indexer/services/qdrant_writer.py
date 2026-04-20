"""Qdrant collection bootstrap + per-page upsert/delete helpers."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels

from indexer.exceptions import QdrantWriterError
from indexer.settings import Settings

_NAMESPACE = uuid.UUID("a8a8a8a8-1111-2222-3333-444444444444")


def _point_id(page_id: str, chunk_index: int) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"{page_id}:{chunk_index}"))


class QdrantWriter:
    def __init__(self, *, client: AsyncQdrantClient, settings: Settings) -> None:
        self.client = client
        self.collection = settings.indexer_qdrant_collection
        self.dim = settings.embeddings_dim

    async def ensure_collection(self) -> None:
        try:
            collections = await self.client.get_collections()
        except Exception as exc:
            raise QdrantWriterError(f"Qdrant unreachable: {exc}") from exc
        existing = {c.name for c in collections.collections}
        if self.collection in existing:
            return
        await self.client.create_collection(
            collection_name=self.collection,
            vectors_config=qmodels.VectorParams(size=self.dim, distance=qmodels.Distance.COSINE),
        )
        for field, schema in [
            ("workspace_id", qmodels.PayloadSchemaType.KEYWORD),
            ("page_id", qmodels.PayloadSchemaType.KEYWORD),
            ("ownership", qmodels.PayloadSchemaType.KEYWORD),
        ]:
            await self.client.create_payload_index(
                collection_name=self.collection,
                field_name=field,
                field_schema=schema,
            )

    async def upsert_page(
        self,
        *,
        page_id: str,
        workspace_id: str,
        ownership: str,
        type_: str,
        title: str | None,
        chunks: Sequence[str],
        vectors: Sequence[Sequence[float]],
    ) -> None:
        if len(chunks) != len(vectors):
            raise QdrantWriterError(f"chunks/vectors mismatch ({len(chunks)} vs {len(vectors)})")
        points = [
            qmodels.PointStruct(
                id=_point_id(page_id, i),
                vector=list(vec),
                payload={
                    "workspace_id": workspace_id,
                    "page_id": page_id,
                    "ownership": ownership,
                    "type": type_,
                    "title": title or "",
                    "chunk_index": i,
                    "chunk_text": chunk,
                },
            )
            for i, (chunk, vec) in enumerate(zip(chunks, vectors, strict=True))
        ]
        await self._delete_chunks_above(page_id, len(chunks))
        if points:
            await self.client.upsert(collection_name=self.collection, points=points)

    async def delete_page(self, *, page_id: str) -> None:
        await self.client.delete(
            collection_name=self.collection,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="page_id", match=qmodels.MatchValue(value=page_id)
                        )
                    ]
                )
            ),
        )

    async def _delete_chunks_above(self, page_id: str, keep: int) -> None:
        await self.client.delete(
            collection_name=self.collection,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="page_id", match=qmodels.MatchValue(value=page_id)
                        ),
                        qmodels.FieldCondition(
                            key="chunk_index",
                            range=qmodels.Range(gte=keep),
                        ),
                    ]
                )
            ),
        )
