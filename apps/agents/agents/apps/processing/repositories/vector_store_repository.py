from dataclasses import dataclass
from typing import Any

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
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
    """Обёртка над Qdrant для векторных операций."""

    client: AsyncQdrantClient

    async def list_collections(self) -> list[str]:
        res = await self.client.get_collections()
        return [collection.name for collection in res.collections]

    async def collection_exists(self, name: str) -> bool:
        try:
            await self.client.get_collection(name)
            return True
        except UnexpectedResponse as e:
            if e.status_code == 404:
                return False
            raise

    async def ensure_collection(self, name: str, vector_size: int) -> None:
        try:
            await self.client.create_collection(
                name,
                vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
            )
        except UnexpectedResponse as e:
            # 409: collection already exists — idempotent, safe to ignore.
            if e.status_code != 409:
                raise

    async def delete_by_page(self, collection_name: str, page_id: str) -> None:
        if not await self.collection_exists(collection_name):
            return
        await self.client.delete(
            collection_name,
            points_selector=Filter(
                must=[FieldCondition(key='pageId', match=MatchValue(value=page_id))],
            ),
        )

    async def delete_by_workspace(self, collection_name: str, workspace_id: str) -> None:
        if not await self.collection_exists(collection_name):
            return
        await self.client.delete(
            collection_name,
            points_selector=Filter(
                must=[FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))],
            ),
        )

    async def upsert_chunks(
        self,
        collection_name: str,
        points: list[tuple[str, list[float], dict[str, Any]]],
    ) -> None:
        if not points:
            return
        await self.client.upsert(
            collection_name,
            points=[PointStruct(id=pid, vector=vec, payload=pl) for (pid, vec, pl) in points],
        )

    async def similarity_search(
        self,
        *,
        collection_name: str,
        embeddings: Embeddings,
        workspace_id: str,
        query: str,
        k: int = 5,
        score_threshold: float | None = None,
    ) -> list[Document]:
        """Embed `query`, run a workspace-filtered vector search, return Documents.

        Bypasses langchain-qdrant's QdrantVectorStore (which requires sync QdrantClient)
        by calling AsyncQdrantClient.query_points directly.

        ``score_threshold=None`` disables similarity filtering; a float value applies a
        Qdrant minimum-similarity cutoff and drops results below it.
        """
        if not query.strip():
            return []
        if not await self.collection_exists(collection_name):
            return []
        vector = await embeddings.aembed_query(query)
        res = await self.client.query_points(
            collection_name=collection_name,
            query=vector,
            limit=k,
            score_threshold=score_threshold,
            query_filter=Filter(must=[FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))]),
            with_payload=True,
            with_vectors=False,
        )
        return [
            Document(
                page_content=str(point.payload.get('content', '')),
                metadata=dict(point.payload),
            )
            for point in res.points
            if point.payload
        ]
