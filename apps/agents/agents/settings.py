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


settings = SettingsSchema()  # pyright: ignore[reportCallIssue]  # all fields populated from env
