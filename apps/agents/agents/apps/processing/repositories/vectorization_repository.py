from dataclasses import dataclass

from langchain_ollama import OllamaEmbeddings


@dataclass
class VectorizationRepository:
    """Обёртка над OllamaEmbeddings для векторизации текста."""

    embeddings: OllamaEmbeddings

    async def embed(self, text: str) -> list[float]:
        return (await self.embeddings.aembed_documents([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return await self.embeddings.aembed_documents(texts)
