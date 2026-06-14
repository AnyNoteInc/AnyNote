"""Dishka providers for the transcription / meeting-summarize application.

fast_clean's ContainerManager auto-discovers any module-level Provider instance
in a module named `depends`, so defining `provider` here registers it — no central
container edit needed (mirrors processing/depends.py).
"""

from dishka import Provider, Scope, provide
from fast_clean.repositories import SettingsRepositoryProtocol

from agents.settings import SettingsSchema

from .repositories import S3StorageRepository, TranscriptionFactory
from .use_cases import SummarizeUseCase, TranscribeUseCase


class TranscriptionProvider(Provider):
    scope = Scope.REQUEST

    transcription_factory = provide(TranscriptionFactory, scope=Scope.APP)
    # ModelFactoryRepository is already provided APP-scoped by AgentProvider
    # (which is in the same container via apply_routes); dishka resolves it
    # across providers, so we must NOT re-provide it here (duplicate binding).

    @provide(scope=Scope.APP)
    async def s3_storage_repository(
        self,
        settings_repository: SettingsRepositoryProtocol,
    ) -> S3StorageRepository:
        settings = await settings_repository.get(SettingsSchema)
        return S3StorageRepository(
            endpoint=settings.s3_endpoint,
            region=settings.s3_region,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            bucket=settings.s3_bucket,
        )

    transcribe_use_case = provide(TranscribeUseCase)
    summarize_use_case = provide(SummarizeUseCase)


provider = TranscriptionProvider()
