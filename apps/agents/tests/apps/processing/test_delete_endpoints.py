import asyncio
from uuid import uuid4

import pytest
from agents.bootstrap import create_app
from agents.router import apply_routes
from agents.settings import SettingsSchema
from fast_clean.schemas import BearerTokenAuthSchema
from fastapi.testclient import TestClient
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


async def _make_qdrant_client() -> AsyncQdrantClient:
    settings = SettingsSchema()
    auth = settings.qdrant.auth
    api_key = auth.bearer_token if isinstance(auth, BearerTokenAuthSchema) else None
    return AsyncQdrantClient(
        url=str(settings.qdrant.host).rstrip('/'),
        api_key=api_key,
    )


async def _delete_collection_if_exists(client: AsyncQdrantClient, collection_name: str) -> None:
    try:
        await client.delete_collection(collection_name)
    except UnexpectedResponse as error:
        if error.status_code != 404:
            raise


async def _create_collection(client: AsyncQdrantClient, collection_name: str) -> None:
    await _delete_collection_if_exists(client, collection_name)
    await client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(size=2, distance=Distance.COSINE),
    )


async def _workspace_point_count(
    client: AsyncQdrantClient,
    collection_name: str,
    workspace_id: str,
) -> int:
    points, _ = await client.scroll(
        collection_name=collection_name,
        scroll_filter=Filter(
            must=[FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))],
        ),
        limit=10,
        with_payload=True,
        with_vectors=False,
    )
    return len(points)


async def _wait_for_workspace_point_count(
    client: AsyncQdrantClient,
    collection_name: str,
    workspace_id: str,
    expected_count: int,
) -> None:
    for _ in range(20):
        if await _workspace_point_count(client, collection_name, workspace_id) == expected_count:
            return
        await asyncio.sleep(0.05)

    actual_count = await _workspace_point_count(client, collection_name, workspace_id)
    assert actual_count == expected_count


@pytest.mark.integration
def test_delete_page_vectors_idempotent() -> None:
    app = create_app([apply_routes])
    with TestClient(app) as client:
        response = client.delete('/vectorization/pages/00000000-0000-0000-0000-000000000000')
        second_response = client.delete('/vectorization/pages/00000000-0000-0000-0000-000000000000')
    assert response.status_code == 200
    assert second_response.status_code == 200
    body = response.json()
    assert 'deletedCollections' in body


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delete_workspace_vectors_idempotent() -> None:
    suffix = uuid4().hex
    page_collections = [
        f'pages_task9_workspace_delete_{suffix}_a',
        f'pages_task9_workspace_delete_{suffix}_b',
    ]
    non_page_collection = f'task9_workspace_delete_{suffix}'
    collection_names = [*page_collections, non_page_collection]
    target_workspace_id = str(uuid4())
    other_workspace_id = str(uuid4())
    qdrant = await _make_qdrant_client()

    try:
        for collection_name in collection_names:
            await _create_collection(qdrant, collection_name)

        for collection_name in page_collections:
            await qdrant.upsert(
                collection_name=collection_name,
                wait=True,
                points=[
                    PointStruct(
                        id=str(uuid4()),
                        vector=[1.0, 0.0],
                        payload={'workspaceId': target_workspace_id, 'kind': 'target'},
                    ),
                    PointStruct(
                        id=str(uuid4()),
                        vector=[0.0, 1.0],
                        payload={'workspaceId': other_workspace_id, 'kind': 'other'},
                    ),
                ],
            )
        await qdrant.upsert(
            collection_name=non_page_collection,
            wait=True,
            points=[
                PointStruct(
                    id=str(uuid4()),
                    vector=[1.0, 0.0],
                    payload={'workspaceId': target_workspace_id, 'kind': 'non-page'},
                )
            ],
        )

        app = create_app([apply_routes])
        with TestClient(app) as client:
            response = client.delete(f'/vectorization/workspaces/{target_workspace_id}')
            second_response = client.delete(f'/vectorization/workspaces/{target_workspace_id}')

        assert response.status_code == 200
        assert second_response.status_code == 200
        body = response.json()
        second_body = second_response.json()
        assert set(page_collections).issubset(body['deletedCollections'])
        assert set(page_collections).issubset(second_body['deletedCollections'])
        assert non_page_collection not in body['deletedCollections']
        assert non_page_collection not in second_body['deletedCollections']

        for collection_name in page_collections:
            await _wait_for_workspace_point_count(qdrant, collection_name, target_workspace_id, 0)
            assert await _workspace_point_count(qdrant, collection_name, other_workspace_id) == 1
        assert await _workspace_point_count(qdrant, non_page_collection, target_workspace_id) == 1
    finally:
        for collection_name in collection_names:
            await _delete_collection_if_exists(qdrant, collection_name)
        await qdrant.close()
