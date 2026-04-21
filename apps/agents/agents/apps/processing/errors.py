"""Processing module error taxonomy."""

from __future__ import annotations

from fast_clean.exceptions import BusinessLogicException


class ProcessingException(BusinessLogicException):

    @property
    def message(self) -> str:
        return "An error occurred during processing."


class UnsupportedLanguageError(BusinessLogicException):

    @property
    def message(self) -> str:
        return "The language is not supported for processing."
