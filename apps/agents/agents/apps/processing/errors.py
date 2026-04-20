"""Processing module error taxonomy."""

from __future__ import annotations

from agents.exceptions import AgentException


class ProcessingException(AgentException):
    """Base class for processing module failures."""

    code = "PROCESSING_ERROR"
    http_status = 500


class UnsupportedLanguageError(ProcessingException):
    code = "UNSUPPORTED_LANGUAGE"
    http_status = 400
