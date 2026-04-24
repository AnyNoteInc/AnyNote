
import re
import unicodedata
from typing import Literal

import spacy
from langchain_text_splitters import RecursiveCharacterTextSplitter
from spacy.language import Language

from .language_detector import LanguageDetectorService

PIPELINE_NAMES = {
    "ru": "ru_core_news_sm",
    "en": "en_core_web_sm",
}

SERVICE_CHARS_RE = re.compile(r"[^\w\s]|_", re.UNICODE)
WHITESPACE_RE = re.compile(r"\s+")
TEXT_SPLITTER_CHUNK_SIZE = 500
TEXT_SPLITTER_CHUNK_OVERLAP = 100

RequestedLanguage = Literal["ru", "en", "auto"]


class NormalizerService:
    """spaCy-backed text normalizer. Loads both models on construction."""

    def __init__(self, detector: LanguageDetectorService) -> None:
        self.pipelines: dict[str, Language] = {
            lang: spacy.load(model_name) for lang, model_name in PIPELINE_NAMES.items()
        }
        self.detector = detector
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=TEXT_SPLITTER_CHUNK_SIZE,
            chunk_overlap=TEXT_SPLITTER_CHUNK_OVERLAP,
            length_function=len,
        )

    def normalize(self, text: str, language: RequestedLanguage) -> tuple[list[str], Literal["ru", "en"]]:
        """Run the full normalization pipeline.

        Returns (normalized_chunks, effective_language).
        """
        if not text:
            return ([], "ru" if language == "auto" else language)

        # 1. Unicode NFC
        text = unicodedata.normalize("NFC", text)
        # 2. Lowercase
        text = text.lower()
        # 3. Remove service chars (punctuation, underscores) → space
        text = SERVICE_CHARS_RE.sub(" ", text)
        # 4. Collapse whitespace
        text = WHITESPACE_RE.sub(" ", text).strip()

        if not text:
            return ([], "ru" if language == "auto" else language)

        # 5. Language detection if auto
        effective_lang = self.detector.detect(text) if language == "auto" else language

        nlp = self.pipelines[effective_lang]

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

        normalized_text = " ".join(lemmas)
        if not normalized_text:
            return ([], effective_lang)

        chunks = [chunk.strip() for chunk in self.splitter.split_text(normalized_text) if chunk.strip()]
        return (chunks, effective_lang)
