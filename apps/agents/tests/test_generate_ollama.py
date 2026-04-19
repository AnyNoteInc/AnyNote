"""End-to-end test: real Ollama + real server. Marked @integration.

Requires:
  docker compose up -d         # for postgres (agents DB) and ollama
  ollama pull gemma4            # default model
"""

from __future__ import annotations

import json
import uuid

import httpx
import pytest

from agents.main import create_app

pytestmark = pytest.mark.integration


def _payload() -> dict[str, object]:
    return {
        "threadId": str(uuid.uuid4()),
        "model": {
            "provider": "ollama",
            "name": "gemma4",
            "connection": {"baseUrl": "http://localhost:11434"},
            "settings": {"temperature": 0.0, "maxOutputTokens": 64},
        },
        "conversation": {"messages": []},
        "userRequest": {"text": "Ответь одним словом: привет"},
    }


@pytest.mark.asyncio
async def test_generate_streams_tokens_from_ollama() -> None:
    # Probe Ollama — skip if unreachable.
    try:
        async with httpx.AsyncClient() as probe:
            r = await probe.get("http://localhost:11434/api/tags", timeout=2.0)
            r.raise_for_status()
    except Exception as exc:
        pytest.skip(f"Ollama not reachable: {exc!r}")

    app = create_app()
    tokens: list[str] = []
    saw_done = False

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120.0
    ) as client:
        async with client.stream(
            "POST",
            "/api/v1/generate",
            json=_payload(),
            headers={"Authorization": "Bearer test-token-123"},
        ) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = json.loads(line.removeprefix("data:").strip())
                if payload.get("type") == "token":
                    tokens.append(payload["text"])
                elif payload.get("type") == "done":
                    saw_done = True
                    break
                elif payload.get("type") == "error":
                    pytest.fail(f"mid-stream error: {payload}")

    assert tokens, "no tokens streamed"
    assert saw_done, "no done event"
