from typing import Annotated

from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreServiceSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field


class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: CoreServiceSettingsSchema
    agents_jwt_secret: str | None = None
    better_auth_jwt_agents_audience: str = 'agents'
    web_base_url: str = 'http://localhost:3000'
    # S3/MinIO — same flat env names as web's @repo/storage (S3_ENDPOINT etc.).
    # Read by the transcription S3 storage repo for the real adapter; the mock
    # adapter never touches S3 so these stay optional for dev/CI.
    s3_endpoint: str | None = None
    s3_region: str = 'us-east-1'
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_bucket: str | None = None
    sentry_environment: str = 'development'
    sentry_traces_sample_rate: float = 0.1


settings = SettingsSchema()  # pyright: ignore[reportCallIssue]  # all fields populated from env
