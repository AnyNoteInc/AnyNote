from dataclasses import dataclass
from typing import Any

from langchain_ollama import OllamaEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import (
    Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams,
)

COLLECTION = 'pages'
VECTOR_SIZE = 768


@dataclass
class VectorStoreRepository:
    """Обёртка над Qdrant collection `pages` для векторных операций."""

    client: AsyncQdrantClient
    embeddings: OllamaEmbeddings

    async def ensure_collection(self) -> None:
        cols = await self.client.get_collections()
        if not any(c.name == COLLECTION for c in cols.collections):
            await self.client.create_collection(
                COLLECTION,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )

    async def delete_by_page(self, page_id: str) -> None:
        await self.client.delete(
            COLLECTION,
            points_selector=Filter(must=[
                FieldCondition(key='pageId', match=MatchValue(value=page_id))
            ]),
        )

    async def upsert_chunks(
        self, points: list[tuple[str, list[float], dict[str, Any]]],
    ) -> None:
        if not points:
            return
        await self.client.upsert(
            COLLECTION,
            points=[
                PointStruct(id=pid, vector=vec, payload=pl)
                for (pid, vec, pl) in points
            ],
        )

    def as_retriever(self, workspace_id: str, k: int = 5):  # type: ignore[no-untyped-def]
        store = QdrantVectorStore(
            client=self.client,
            collection_name=COLLECTION,
            embedding=self.embeddings,
        )
        return store.as_retriever(
            search_kwargs={
                'k': k,
                'filter': Filter(must=[
                    FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))
                ]),
            },
        )
