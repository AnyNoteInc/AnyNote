"""Integration test — requires docker compose running (Qdrant + Ollama with nomic-embed-text)."""

from uuid import uuid4

import pytest
from agents.apps.processing.repositories import VectorStoreRepository
from agents.settings import SettingsSchema
from langchain_ollama import OllamaEmbeddings
from qdrant_client import AsyncQdrantClient


@pytest.mark.integration
@pytest.mark.asyncio
async def test_full_indexing_then_retrieval_roundtrip() -> None:
    """End-to-end: vectorize → store in Qdrant → search via similarity_search.

    Proves C1 is fixed: AsyncQdrantClient.query_points works correctly;
    the old as_retriever path would crash with AttributeError.
    """
    settings = SettingsSchema()
    auth = settings.qdrant.auth
    client = AsyncQdrantClient(
        url=settings.qdrant.url,
        api_key=auth.bearer_token if auth else None,
    )
    embeddings = OllamaEmbeddings(
        base_url=settings.ollama.url,
        model=settings.ollama.embedding_model,
    )
    repo = VectorStoreRepository(
        client=client,
        embeddings=embeddings,
        collection_name=settings.qdrant.collection_name,
        vector_size=settings.qdrant.vector_size,
    )

    workspace_id = str(uuid4())
    page_id = str(uuid4())

    try:
        # Ensure collection exists
        await repo.ensure_collection()

        # Step 1: embed and upsert a test document directly
        content = 'Корпоративный кофе называется «Бразильский Медведь».'
        vector = await embeddings.aembed_query(content)
        import uuid
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f'{page_id}:0'))
        await repo.upsert_chunks([
            (point_id, vector, {
                'pageId': page_id,
                'workspaceId': workspace_id,
                'title': 'Cafe',
                'pageType': 'TEXT',
                'blockNumber': 0,
                'content': content,
            })
        ])

        # Step 2: retrieve via similarity_search — this is the C1 proof
        docs = await repo.similarity_search(
            workspace_id=workspace_id, query='корпоративный кофе', k=5,
        )

        assert len(docs) >= 1, f'Expected at least 1 doc, got {len(docs)}'
        page_ids = {d.metadata.get('pageId') for d in docs}
        assert page_id in page_ids, f'Expected pageId {page_id!r} in {page_ids}'

    finally:
        # Clean up test data
        await repo.delete_by_page(page_id)
        await client.close()
