from typing import Any
from uuid import uuid4

import pytest
from agents.apps.agent.schemas import RagDocumentSchema
from agents.apps.agent.services.rag_retrieval import RagRetrievalService
from agents.bootstrap import create_app
from agents.router import apply_routes
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def app_with_mock_rag(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[FastAPI, list[RagDocumentSchema], dict[str, Any]]:
    docs = [
        RagDocumentSchema(
            page_id=uuid4(),
            workspace_id=uuid4(),
            title='Page A',
            page_type='TEXT',
            block_number=2,
            content='hello world',
        ),
    ]
    captured: dict[str, Any] = {}

    async def fake_retrieve(
        self: RagRetrievalService,
        *,
        embedding: Any,
        workspace_id: Any,
        query: str,
        k: int = 5,
        score_threshold: float | None = None,
    ) -> list[RagDocumentSchema]:
        captured['score_threshold'] = score_threshold
        return docs

    monkeypatch.setattr(RagRetrievalService, 'retrieve', fake_retrieve)
    return create_app([apply_routes]), docs, captured


def _payload(workspace_id: str, query: str = 'hello') -> dict[str, object]:
    return {
        'workspaceId': workspace_id,
        'query': query,
        'limit': 10,
        'embedding': {
            'provider': 'ollama',
            'modelSlug': 'nomic-embed-text',
            'vectorSize': 768,
            'connection': {'baseUrl': 'http://localhost:11434'},
        },
    }


def test_search_returns_rag_results(
    app_with_mock_rag: tuple[FastAPI, list[RagDocumentSchema], dict[str, Any]],
) -> None:
    app, _docs, captured = app_with_mock_rag
    with TestClient(app) as client:
        ws_id = str(uuid4())
        res = client.post('/v1/search', json=_payload(ws_id))
        assert res.status_code == 200
        assert captured['score_threshold'] == pytest.approx(0.7)
        body = res.json()
        assert len(body['results']) == 1
        assert body['results'][0]['title'] == 'Page A'
        assert body['results'][0]['blockNumber'] == 2
        assert body['results'][0]['content'] == 'hello world'


def test_search_rejects_empty_query() -> None:
    app = create_app([apply_routes])
    with TestClient(app) as client:
        ws_id = str(uuid4())
        payload = _payload(ws_id, query='')
        res = client.post('/v1/search', json=payload)
        assert res.status_code == 422


def test_search_rejects_long_query() -> None:
    app = create_app([apply_routes])
    with TestClient(app) as client:
        ws_id = str(uuid4())
        payload = _payload(ws_id, query='x' * 600)
        res = client.post('/v1/search', json=payload)
        assert res.status_code == 422
