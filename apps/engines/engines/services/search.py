"""Vector search over the indexer's Qdrant collection."""

from __future__ import annotations

from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels


@dataclass(slots=True)
class SearchHit:
    page_id: str
    workspace_id: str
    title: str
    chunk_text: str
    score: float


class SearchService:
    def __init__(self, *, client: AsyncQdrantClient, collection: str) -> None:
        self.client = client
        self.collection = collection

    async def search(
        self,
        *,
        query_vector: list[float],
        workspace_id: str,
        top_k: int = 5,
    ) -> list[SearchHit]:
        response = await self.client.query_points(
            collection_name=self.collection,
            query=query_vector,
            limit=max(1, min(top_k, 20)),
            query_filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="workspace_id",
                        match=qmodels.MatchValue(value=workspace_id),
                    )
                ],
            ),
            with_payload=True,
        )
        hits: list[SearchHit] = []
        for r in response.points:
            payload = r.payload or {}
            hits.append(
                SearchHit(
                    page_id=str(payload.get("page_id", "")),
                    workspace_id=str(payload.get("workspace_id", "")),
                    title=str(payload.get("title", "") or ""),
                    chunk_text=str(payload.get("chunk_text", "") or ""),
                    score=float(r.score),
                )
            )
        return hits
