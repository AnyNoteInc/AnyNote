from agents.apps.processing.services.language_detector import LanguageDetectorService
from agents.apps.processing.services.normalizer import NormalizerService


def test_normalize_russian_text() -> None:
    service = NormalizerService(LanguageDetectorService())
    result = service.normalize('Привет, мир! Это тестовый текст.')
    assert isinstance(result, str)
    assert len(result) > 0
    assert result == result.lower()


def test_normalize_english_text() -> None:
    service = NormalizerService(LanguageDetectorService())
    result = service.normalize('Hello world! This is a test.')
    assert isinstance(result, str)
    assert len(result) > 0
    assert result == result.lower()


def test_normalize_empty_string_returns_empty() -> None:
    service = NormalizerService(LanguageDetectorService())
    assert service.normalize('') == ''
    assert service.normalize('   ') == ''


def test_normalize_strips_punctuation() -> None:
    service = NormalizerService(LanguageDetectorService())
    result = service.normalize('Hello!!! World...')
    assert '!' not in result
    assert '.' not in result
