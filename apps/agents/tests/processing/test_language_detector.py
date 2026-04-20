"""Tests for LanguageDetector."""

from __future__ import annotations

import pytest

from agents.apps.processing.services.language_detector import LanguageDetector


@pytest.fixture
def detector() -> LanguageDetector:
    return LanguageDetector()


def test_detects_russian(detector: LanguageDetector) -> None:
    assert detector.detect("Привет мир, это тестовое сообщение") == "ru"


def test_detects_english(detector: LanguageDetector) -> None:
    assert detector.detect("Hello world this is a test message") == "en"


def test_empty_defaults_to_ru(detector: LanguageDetector) -> None:
    assert detector.detect("") == "ru"


def test_non_supported_falls_back_to_ru(detector: LanguageDetector) -> None:
    # Japanese / Chinese glyphs detected but not in {ru,en} → fallback.
    assert detector.detect("こんにちは世界") == "ru"
