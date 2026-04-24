from dataclasses import dataclass
from typing import Any

from langchain_core.documents import Document
from langchain_ollama import OllamaEmbeddings
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)


@dataclass
class VectorStoreRepository:
    """Обёртка над Qdrant collection для векторных операций."""

    client: AsyncQdrantClient
    embeddings: OllamaEmbeddings
    collection_name: str
    vector_size: int

    async def ensure_collection(self) -> None:
        cols = await self.client.get_collections()
        if not any(c.name == self.collection_name for c in cols.collections):
            await self.client.create_collection(
                self.collection_name,
                vectors_config=VectorParams(size=self.vector_size, distance=Distance.COSINE),
            )

    async def delete_by_page(self, page_id: str) -> None:
        await self.client.delete(
            self.collection_name,
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
            self.collection_name,
            points=[
                PointStruct(id=pid, vector=vec, payload=pl)
                for (pid, vec, pl) in points
            ],
        )

    async def similarity_search(
        self, workspace_id: str, query: str, k: int = 5,
    ) -> list[Document]:
        """Embed `query`, run a workspace-filtered vector search, return Documents.

        Bypasses langchain-qdrant's QdrantVectorStore (which requires sync QdrantClient)
        by calling AsyncQdrantClient.query_points directly.
        """
        if not query.strip():
            return []
        vector = await self.embeddings.aembed_query(query)
        res = await self.client.query_points(
            collection_name=self.collection_name,
            query=vector,
            limit=k,
            query_filter=Filter(must=[
                FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))
            ]),
            with_payload=True,
            with_vectors=False,
        )
        return [
            Document(
                page_content=str(point.payload.get('content', '')) if point.payload else '',
                metadata=dict(point.payload) if point.payload else {},
            )
            for point in res.points
        ]
