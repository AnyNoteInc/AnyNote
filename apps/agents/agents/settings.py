from typing import Annotated

from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field


class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema

settings = SettingsSchema()  # type: ignore
