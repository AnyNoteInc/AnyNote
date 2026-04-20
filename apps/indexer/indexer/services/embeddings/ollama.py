"""Ollama embeddings adapter (HTTP)."""

from __future__ import annotations

import httpx

from indexer.exceptions import EmbeddingsError


class OllamaEmbeddings:
    def __init__(self, *, base_url: str, model: str, dim: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.dim = dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            vectors: list[list[float]] = []
            for text in texts:
                try:
                    resp = await client.post(
                        f"{self.base_url}/api/embeddings",
                        json={"model": self.model, "prompt": text},
                    )
                except httpx.HTTPError as exc:
                    raise EmbeddingsError(f"Ollama transport error: {exc}") from exc
                if resp.status_code != 200:
                    raise EmbeddingsError(f"Ollama returned {resp.status_code}: {resp.text[:200]}")
                payload = resp.json()
                vec = payload.get("embedding")
                if not isinstance(vec, list) or len(vec) != self.dim:
                    raise EmbeddingsError(
                        f"Unexpected Ollama embedding shape (got {type(vec).__name__}, "
                        f"len={len(vec) if isinstance(vec, list) else 'n/a'}, expected {self.dim})"
                    )
                vectors.append([float(x) for x in vec])
            return vectors
