"""Dishka providers for the processing (vectorization) application."""

from __future__ import annotations

from dishka import Provider, Scope, provide
from fast_clean.repositories import SettingsRepositoryProtocol
from langchain_ollama import OllamaEmbeddings
from qdrant_client import AsyncQdrantClient

from agents.settings import SettingsSchema

from .repositories import VectorizationRepository, VectorStoreRepository
from .services import ChunkerService, LanguageDetectorService, NormalizerService
from .use_cases import VectorizePageUseCase


class ProcessingProvider(Provider):
    scope = Scope.REQUEST

    chunker_service = provide(ChunkerService, scope=Scope.APP)
    language_detector_service = provide(LanguageDetectorService, scope=Scope.APP)
    normalizer_service = provide(NormalizerService, scope=Scope.APP)

    @provide
    async def vector_store_repository(
        self,
        client: AsyncQdrantClient,
        embeddings: OllamaEmbeddings,
        settings_repository: SettingsRepositoryProtocol,
    ) -> VectorStoreRepository:
        settings = await settings_repository.get(SettingsSchema)
        return VectorStoreRepository(
            client=client,
            embeddings=embeddings,
            collection_name=settings.qdrant.collection_name,
            vector_size=settings.qdrant.vector_size,
        )

    vectorization_repository = provide(VectorizationRepository)

    vectorize_page_use_case = provide(VectorizePageUseCase)


provider = ProcessingProvider()
