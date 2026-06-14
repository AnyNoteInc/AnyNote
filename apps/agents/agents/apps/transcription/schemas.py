"""Request/response schemas for the transcription + meeting-summarize endpoints.

The base RequestResponseSchema applies camelCase aliasing on both validation and
serialization, so Python fields stay snake_case while the HTTP wire format is
camelCase (matching the web meeting-client).
"""

from fast_clean.schemas.request_response import RequestResponseSchema
from pydantic import ConfigDict, Field

from agents.apps.agent.schemas import ModelConfigSchema

# populate_by_name lets us construct with snake_case field names in Python while
# the base RequestResponseSchema still validates/serializes the camelCase wire
# format (the ModelConfigSchema precedent).
_BY_NAME = ConfigDict(populate_by_name=True)


class TranscriptSegmentSchema(RequestResponseSchema):
    model_config = _BY_NAME

    idx: int
    start_ms: int
    end_ms: int
    speaker: str | None = None
    text: str


class TranscribeRequestSchema(RequestResponseSchema):
    model_config = _BY_NAME

    workspace_id: str
    recording_s3_key: str
    mime_type: str
    provider: str = 'mock'
    language: str | None = None


class TranscribeResponseSchema(RequestResponseSchema):
    model_config = _BY_NAME

    segments: list[TranscriptSegmentSchema] = Field(default_factory=list)
    language: str | None = None
    duration_ms: int | None = None


class SummarizeRequestSchema(RequestResponseSchema):
    model_config = _BY_NAME

    model: ModelConfigSchema
    transcript: str
    summary_instruction: str | None = None


class SummarizeResponseSchema(RequestResponseSchema):
    model_config = _BY_NAME

    summary: str
    action_items: list[str] = Field(default_factory=list)
