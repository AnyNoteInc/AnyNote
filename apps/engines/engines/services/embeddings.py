"""Embeddings adapter for query-time vector lookup."""

from __future__ import annotations

import httpx

from engines.exceptions import ToolError


class OllamaEmbeddings:
    def __init__(self, *, base_url: str, model: str, dim: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.dim = dim

    async def embed(self, text: str) -> list[float]:
        if not text:
            raise ToolError("empty embedding text")
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/api/embeddings",
                    json={"model": self.model, "prompt": text},
                )
            except httpx.HTTPError as exc:
                raise ToolError(f"Ollama transport error: {exc}") from exc
            if resp.status_code != 200:
                raise ToolError(f"Ollama returned {resp.status_code}: {resp.text[:200]}")
            payload = resp.json()
            vec = payload.get("embedding")
            if not isinstance(vec, list) or len(vec) != self.dim:
                raise ToolError(
                    f"Unexpected Ollama embedding shape (expected {self.dim} floats)",
                )
            return [float(x) for x in vec]
