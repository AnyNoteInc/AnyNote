from typing import Literal

from agents.apps.processing.services.language_detector import LanguageDetectorService
from agents.apps.processing.services.normalizer import NormalizerService
from pytest import MonkeyPatch


class FakeToken:
    def __init__(self, text: str) -> None:
        self.lemma_ = text
        self.is_stop = False
        self.is_punct = False
        self.is_space = False


class FakePipeline:
    def __call__(self, text: str) -> list[FakeToken]:
        return [FakeToken(token) for token in text.split()]


class StubLanguageDetector(LanguageDetectorService):
    def detect(self, text: str) -> Literal['ru', 'en']:
        return 'ru'


def test_normalizer_splits_normalized_text_into_overlapping_chunks(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr('agents.apps.processing.services.normalizer.spacy.load', lambda _: FakePipeline())
    service = NormalizerService(StubLanguageDetector())

    raw_text = 'A' * 1200

    chunks, language = service.normalize(raw_text, 'auto')

    assert language == 'ru'
    assert len(chunks) == 3
    assert all(len(chunk) <= 500 for chunk in chunks)
    assert chunks[0][-100:] == chunks[1][:100]
    assert chunks[1][-100:] == chunks[2][:100]
