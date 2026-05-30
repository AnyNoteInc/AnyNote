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


settings = SettingsSchema()  # pyright: ignore[reportCallIssue]  # all fields populated from env
