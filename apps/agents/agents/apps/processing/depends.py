"""Dishka providers for the processing (vectorization) application."""

from __future__ import annotations

from dishka import Provider, Scope, provide

from .repositories import VectorStoreRepository, VectorizationRepository
from .services import ChunkerService, LanguageDetectorService, NormalizerService
from .use_cases import VectorizePageUseCase


class ProcessingProvider(Provider):
    scope = Scope.REQUEST

    chunker_service = provide(ChunkerService, scope=Scope.APP)
    language_detector_service = provide(LanguageDetectorService, scope=Scope.APP)
    normalizer_service = provide(NormalizerService, scope=Scope.APP)

    vectorization_repository = provide(VectorizationRepository)
    vector_store_repository = provide(VectorStoreRepository)

    vectorize_page_use_case = provide(VectorizePageUseCase)


provider = ProcessingProvider()
