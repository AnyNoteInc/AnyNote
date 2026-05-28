"""Dishka providers for the processing (vectorization) application."""

from __future__ import annotations

from dishka import Provider, Scope, provide
from qdrant_client import AsyncQdrantClient

from .repositories import EmbeddingFactoryRepository, VectorStoreRepository
from .services import ChunkerService, LanguageDetectorService, NormalizerService
from .use_cases import DeletePageVectorsUseCase, DeleteWorkspaceVectorsUseCase, ValidateEmbeddingUseCase, VectorizePageUseCase


class ProcessingProvider(Provider):
    scope = Scope.REQUEST

    chunker_service = provide(ChunkerService, scope=Scope.APP)
    language_detector_service = provide(LanguageDetectorService, scope=Scope.APP)
    normalizer_service = provide(NormalizerService, scope=Scope.APP)
    embedding_factory_repository = provide(EmbeddingFactoryRepository, scope=Scope.APP)

    @provide(scope=Scope.APP)
    async def vector_store_repository(
        self,
        client: AsyncQdrantClient,
    ) -> VectorStoreRepository:
        return VectorStoreRepository(client=client)

    vectorize_page_use_case = provide(VectorizePageUseCase)
    delete_page_vectors_use_case = provide(DeletePageVectorsUseCase)
    delete_workspace_vectors_use_case = provide(DeleteWorkspaceVectorsUseCase)
    validate_embedding_use_case = provide(ValidateEmbeddingUseCase)


provider = ProcessingProvider()
