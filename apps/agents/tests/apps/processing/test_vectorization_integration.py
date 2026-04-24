"""Integration test — requires docker compose running (Qdrant on 6333, Ollama on 11434
with nomic-embed-text pulled)."""

from uuid import uuid4

import pytest
from agents.bootstrap import create_app
from agents.router import apply_routes
from fastapi.testclient import TestClient


@pytest.mark.integration
def test_vectorization_end_to_end() -> None:
    app = create_app([apply_routes])
    with TestClient(app) as client:  # runs lifespan → ensures collection
        page_id = str(uuid4())
        ws_id = str(uuid4())
        payload = {
            'pageId': page_id,
            'workspaceId': ws_id,
            'title': 'Integration Test',
            'pageType': 'TEXT',
            'contents': [
                {'blockNumber': 0, 'content': 'Корпоративный кофе называется «Бразильский Медведь».'},
            ],
        }

        res = client.post('/vectorization', json=payload)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body['indexedChunks'] >= 1
        assert body['skippedBlocks'] == 0

        # Second call — should be idempotent (same result, no duplicate points)
        res2 = client.post('/vectorization', json=payload)
        assert res2.status_code == 200
        assert res2.json()['indexedChunks'] == body['indexedChunks']
