"""OpenAI embeddings adapter — scaffold only, not exercised in Pillar D."""

from __future__ import annotations


class OpenAIEmbeddings:
    def __init__(self, *, api_key: str, model: str, dim: int) -> None:
        self.api_key = api_key
        self.model = model
        self.dim = dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError("OpenAI embeddings are scaffolded in Pillar D; wire in Pillar G")
