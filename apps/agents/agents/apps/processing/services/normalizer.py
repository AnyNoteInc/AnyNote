import re
import unicodedata

import spacy
from spacy.language import Language

from .language_detector import LanguageDetectorService

PIPELINE_NAMES = {
    'ru': 'ru_core_news_sm',
    'en': 'en_core_web_sm',
}

SERVICE_CHARS_RE = re.compile(r'[^\w\s]|_', re.UNICODE)
WHITESPACE_RE = re.compile(r'\s+')


class NormalizerService:
    """spaCy-backed text normalizer. Loads both models on construction."""

    def __init__(self, detector: LanguageDetectorService) -> None:
        self.pipelines: dict[str, Language] = {
            lang: spacy.load(model_name) for lang, model_name in PIPELINE_NAMES.items()
        }
        self.detector = detector

    def normalize(self, text: str) -> str:
        """Run the full normalization pipeline: lower + strip punct + NFC
        + tokenize + lemmatize + drop stopwords.

        Returns the normalized string (may be empty).
        """
        if not text or not text.strip():
            return ''

        text = unicodedata.normalize('NFC', text)
        text = text.lower()
        text = SERVICE_CHARS_RE.sub(' ', text)
        text = WHITESPACE_RE.sub(' ', text).strip()

        if not text:
            return ''

        effective_lang = self.detector.detect(text)
        nlp = self.pipelines[effective_lang]

        doc = nlp(text)
        lemmas: list[str] = []
        for token in doc:
            if token.is_stop or token.is_punct or token.is_space:
                continue
            lemma = token.lemma_.strip()
            if len(lemma) < 2:
                continue
            lemmas.append(lemma)

        return ' '.join(lemmas)
