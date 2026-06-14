"""Transcription adapters + the provider-selecting factory.

`provider="mock"` is the default everywhere (dev/CI): it returns a deterministic
canned transcript WITHOUT decoding audio or touching S3. The real adapter is a
wired-but-unexercised stub — an operator must implement it against a paid/self-
hosted provider; it is never invoked in CI.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from agents.apps.agent.errors import InvalidPayloadError

from ..schemas import TranscribeResponseSchema, TranscriptSegmentSchema

# A fixed canned script — the mock derives stable, deterministic segments from it
# so tests and dev get a meaningful (and unchanging) transcript without real audio.
_CANNED_LINES: list[tuple[str, str]] = [
    ('Speaker 1', 'Спасибо, что присоединились к встрече. Начнём с обзора статуса.'),
    ('Speaker 2', 'Спринт идёт по плану, остался один блокер по интеграции с биллингом.'),
    ('Speaker 1', 'Хорошо. Давайте зафиксируем, кто берёт блокер и к какому сроку.'),
    ('Speaker 2', 'Я возьму блокер и закрою его к пятнице, подготовлю PR на ревью.'),
    ('Speaker 1', 'Отлично. Тогда подведём итоги: релиз в пятницу, документация — на следующей неделе.'),
]

_SEGMENT_MS = 6000  # each canned line spans a fixed 6s window


@runtime_checkable
class TranscriptionAdapter(Protocol):
    async def transcribe(
        self,
        audio_bytes: bytes,
        *,
        mime_type: str,
        language: str | None,
    ) -> TranscribeResponseSchema: ...


@dataclass
class MockTranscriptionAdapter:
    """Deterministic, audio-independent transcript for dev/CI."""

    async def transcribe(
        self,
        audio_bytes: bytes,
        *,
        mime_type: str,
        language: str | None,
    ) -> TranscribeResponseSchema:
        segments = [
            TranscriptSegmentSchema(
                idx=idx,
                start_ms=idx * _SEGMENT_MS,
                end_ms=(idx + 1) * _SEGMENT_MS,
                speaker=speaker,
                text=text,
            )
            for idx, (speaker, text) in enumerate(_CANNED_LINES)
        ]
        return TranscribeResponseSchema(
            segments=segments,
            language=language or 'ru',
            duration_ms=len(segments) * _SEGMENT_MS,
        )


@dataclass
class RealTranscriptionAdapter:
    """Wired-but-unexercised real provider stub. Never invoked in CI.

    An operator implements this against a paid/self-hosted transcription provider
    (e.g. Whisper). It receives the already-fetched recording bytes.
    """

    async def transcribe(
        self,
        audio_bytes: bytes,
        *,
        mime_type: str,
        language: str | None,
    ) -> TranscribeResponseSchema:
        raise NotImplementedError(
            'The real transcription adapter is not configured. Use provider="mock" or wire a real provider.'
        )


@dataclass
class TranscriptionFactory:
    @staticmethod
    def make(provider: str) -> TranscriptionAdapter:
        match provider:
            case 'mock':
                return MockTranscriptionAdapter()
            case 'whisper':
                return RealTranscriptionAdapter()
            case _:
                raise InvalidPayloadError(f'Unknown transcription provider: {provider!r}')
