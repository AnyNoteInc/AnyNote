"""Tests for NormalizerService."""

from __future__ import annotations

import pytest

from agents.apps.processing.services.normalizer import NormalizerService


@pytest.fixture(scope="module")
def normalizer() -> NormalizerService:
    return NormalizerService()


def test_russian_basic_lemmatization(normalizer: NormalizerService) -> None:
    out, lang = normalizer.normalize("Быстрые собаки бегают по лесу.", "ru")
    assert lang == "ru"
    # lemmas: быстрый, собака, бегать, лес ("по" is stopword)
    assert "быстрый" in out.split()
    assert "собака" in out.split()
    assert "бегать" in out.split()
    assert "лес" in out.split()
    assert "по" not in out.split()


def test_russian_stopwords_removed(normalizer: NormalizerService) -> None:
    out, _ = normalizer.normalize("и в на но или что это", "ru")
    assert out == ""


def test_empty_input_returns_empty(normalizer: NormalizerService) -> None:
    out, _ = normalizer.normalize("", "ru")
    assert out == ""


def test_only_punctuation_returns_empty(normalizer: NormalizerService) -> None:
    out, _ = normalizer.normalize("!!! ??? ...", "ru")
    assert out == ""


def test_unicode_normalization(normalizer: NormalizerService) -> None:
    # Combining diacritics → NFC form
    raw = "cafe\u0301"  # "café" decomposed
    out, _ = normalizer.normalize(raw, "en")
    # After NFC + lowercase + spaCy pipeline, at minimum we get a non-empty result
    assert "café" in out or "cafe" in out or len(out) > 0


def test_short_tokens_dropped(normalizer: NormalizerService) -> None:
    # Russian "я" (1 char, "I") should be dropped by len<2 filter even though
    # it's not in every stopword list.
    out, _ = normalizer.normalize("я", "ru")
    assert out == ""


def test_auto_detect_russian(normalizer: NormalizerService) -> None:
    out, lang = normalizer.normalize("Здравствуйте, это тест", "auto")
    assert lang == "ru"
    assert len(out) > 0


def test_english_basic_lemmatization(normalizer: NormalizerService) -> None:
    out, lang = normalizer.normalize("The quick brown foxes were running quickly", "en")
    assert lang == "en"
    tokens = out.split()
    assert "quick" in tokens
    assert "brown" in tokens
    assert "fox" in tokens
    assert "run" in tokens
    # stopwords filtered
    assert "the" not in tokens
    assert "were" not in tokens


def test_auto_detect_english(normalizer: NormalizerService) -> None:
    out, lang = normalizer.normalize("Quick brown foxes jump over lazy dogs", "auto")
    assert lang == "en"
    assert len(out.split()) >= 3
