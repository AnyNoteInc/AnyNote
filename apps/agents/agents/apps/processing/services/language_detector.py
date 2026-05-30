"""Language detection wrapper around langdetect."""

from typing import Literal

from langdetect import DetectorFactory, LangDetectException, detect  # type: ignore[import-untyped]

DetectorFactory.seed = 0  # deterministic results

DetectedLanguage = Literal["ru", "en"]


class LanguageDetectorService:
    """Detects language of a text chunk.

    Returns only "ru" or "en"; anything else falls back to "ru" because
    the indexer's downstream pipeline (spaCy) only has models for those.
    """

    def detect(self, text: str) -> DetectedLanguage:
        if not text.strip():
            return "ru"
        try:
            detected = detect(text)
        except LangDetectException:
            return "ru"
        if detected == "en":
            return "en"
        return "ru"
