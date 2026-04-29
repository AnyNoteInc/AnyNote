"""Integration test — requires docker compose running (Qdrant + Ollama with nomic-embed-text)."""

from uuid import uuid4

import pytest
from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.processing.repositories import VectorStoreRepository
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema, ModelConnectionSchema
from agents.apps.processing.utils import collection_name_for
from agents.settings import SettingsSchema
from fast_clean.schemas import BearerTokenAuthSchema
from langchain_ollama import OllamaEmbeddings
from ollama import ResponseError
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
    api_key = auth.bearer_token if isinstance(auth, BearerTokenAuthSchema) else None
    client = AsyncQdrantClient(
        url=str(settings.qdrant.host).rstrip('/'),
        api_key=api_key,
    )
    embedding = EmbeddingProviderConfigSchema(
        provider=ModelProviderEnum.OLLAMA,
        model_slug='nomic-embed-text',
        vector_size=768,
        connection=ModelConnectionSchema(base_url=str(settings.ollama.host).rstrip('/')),
    )
    embeddings = OllamaEmbeddings(
        base_url=embedding.connection.base_url,
        model=embedding.model_slug,
    )
    collection = collection_name_for(embedding.provider, embedding.model_slug)
    repo = VectorStoreRepository(client=client)

    workspace_id = str(uuid4())
    page_id = str(uuid4())

    try:
        # Ensure collection exists
        await repo.ensure_collection(collection, embedding.vector_size)

        # Step 1: embed and upsert a test document directly
        content = 'Корпоративный кофе называется «Бразильский Медведь».'
        try:
            vector = await embeddings.aembed_query(content)
        except ResponseError as e:
            if e.status_code == 404:
                pytest.skip('Ollama model nomic-embed-text is not pulled locally')
            raise
        import uuid
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f'{page_id}:0'))
        await repo.upsert_chunks(collection, [
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
            collection_name=collection,
            embeddings=embeddings,
            workspace_id=workspace_id,
            query='корпоративный кофе',
            k=5,
        )

        assert len(docs) >= 1, f'Expected at least 1 doc, got {len(docs)}'
        page_ids = {d.metadata.get('pageId') for d in docs}
        assert page_id in page_ids, f'Expected pageId {page_id!r} in {page_ids}'

    finally:
        # Clean up test data
        await repo.delete_by_page(collection, page_id)
        await client.close()
