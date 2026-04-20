"""Dishka providers for the processing module."""

from __future__ import annotations

from dishka import Provider, Scope, provide

from agents.apps.processing.services.language_detector import LanguageDetector
from agents.apps.processing.services.normalizer import NormalizerService


class ProcessingProvider(Provider):
    """APP-scoped provider: both services hold loaded NLP models and are reused."""

    scope = Scope.APP

    @provide
    def language_detector(self) -> LanguageDetector:
        return LanguageDetector()

    @provide
    def normalizer(self) -> NormalizerService:
        return NormalizerService()
