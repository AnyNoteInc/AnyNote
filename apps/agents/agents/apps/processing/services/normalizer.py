"""Text normalization pipeline: NFC → lower → strip → lemmatize → stopwords → short-token filter."""

from __future__ import annotations

import re
import unicodedata
from typing import Literal

import spacy
from spacy.language import Language

from agents.apps.processing.services.language_detector import LanguageDetector

_PIPELINE_NAMES = {
    "ru": "ru_core_news_sm",
    "en": "en_core_web_sm",
}

_SERVICE_CHARS_RE = re.compile(r"[^\w\s]|_", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")

RequestedLanguage = Literal["ru", "en", "auto"]


class NormalizerService:
    """spaCy-backed text normalizer. Loads both models on construction."""

    def __init__(self) -> None:
        self._pipelines: dict[str, Language] = {
            lang: spacy.load(model_name) for lang, model_name in _PIPELINE_NAMES.items()
        }
        self._detector = LanguageDetector()

    def normalize(self, text: str, language: RequestedLanguage) -> tuple[str, Literal["ru", "en"]]:
        """Run the full normalization pipeline.

        Returns (normalized_text, effective_language).
        """
        if not text:
            return ("", "ru" if language == "auto" else language)

        # 1. Unicode NFC
        text = unicodedata.normalize("NFC", text)
        # 2. Lowercase
        text = text.lower()
        # 3. Remove service chars (punctuation, underscores) → space
        text = _SERVICE_CHARS_RE.sub(" ", text)
        # 4. Collapse whitespace
        text = _WHITESPACE_RE.sub(" ", text).strip()

        if not text:
            return ("", "ru" if language == "auto" else language)

        # 5. Language detection if auto
        effective_lang: Literal["ru", "en"]
        if language == "auto":
            effective_lang = self._detector.detect(text)
        else:
            effective_lang = language

        nlp = self._pipelines[effective_lang]

        # 6-8. Tokenize + lemmatize + filter stopwords/punct/short
        doc = nlp(text)
        lemmas: list[str] = []
        for token in doc:
            if token.is_stop or token.is_punct or token.is_space:
                continue
            lemma = token.lemma_.strip()
            if len(lemma) < 2:
                continue
            lemmas.append(lemma)

        return (" ".join(lemmas), effective_lang)
