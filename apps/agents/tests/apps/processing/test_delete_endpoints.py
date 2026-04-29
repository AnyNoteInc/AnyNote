import pytest
from agents.bootstrap import create_app
from agents.router import apply_routes
from fastapi.testclient import TestClient


@pytest.mark.integration
def test_delete_page_vectors_idempotent() -> None:
    app = create_app([apply_routes])
    with TestClient(app) as client:
        response = client.delete('/vectorization/pages/00000000-0000-0000-0000-000000000000')
    assert response.status_code == 200
    body = response.json()
    assert 'deletedCollections' in body
