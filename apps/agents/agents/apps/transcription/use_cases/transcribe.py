"""Transcribe use case: select the adapter, read S3 only for the real path."""

from dataclasses import dataclass

from ..repositories.s3_storage import S3StorageRepository
from ..repositories.transcription_factory import MockTranscriptionAdapter, TranscriptionFactory
from ..schemas import TranscribeRequestSchema, TranscribeResponseSchema


@dataclass
class TranscribeUseCase:
    s3: S3StorageRepository
    factory: TranscriptionFactory

    async def __call__(self, payload: TranscribeRequestSchema) -> TranscribeResponseSchema:
        adapter = self.factory.make(payload.provider)
        # The mock is audio-independent — never read S3 (no real object required
        # in dev/CI). Only the real adapter needs the recording bytes.
        audio_bytes = b''
        if not isinstance(adapter, MockTranscriptionAdapter):
            audio_bytes = await self.s3.get_bytes(payload.recording_s3_key)
        return await adapter.transcribe(
            audio_bytes,
            mime_type=payload.mime_type,
            language=payload.language,
        )
