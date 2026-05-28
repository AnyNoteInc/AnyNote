"""Unauthenticated provider/MCP validation routes (internal network only)."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from agents.apps.agent.schemas import (
    LlmValidationResponse,
    McpServerSchema,
    McpValidationResponse,
    ModelConfigSchema,
)
from agents.apps.agent.use_cases.validate_provider import ValidateLlmUseCase, ValidateMcpUseCase
from agents.apps.processing.schemas import EmbeddingValidationRequest, EmbeddingValidationResponse
from agents.apps.processing.use_cases.validate_embedding import ValidateEmbeddingUseCase

router = APIRouter(prefix='/validation', tags=['Validation'])


@router.post('/llm', response_model=LlmValidationResponse)
@inject
async def validate_llm(
    payload: ModelConfigSchema,
    use_case: FromDishka[ValidateLlmUseCase],
) -> LlmValidationResponse:
    return await use_case(payload)


@router.post('/embedding', response_model=EmbeddingValidationResponse)
@inject
async def validate_embedding(
    payload: EmbeddingValidationRequest,
    use_case: FromDishka[ValidateEmbeddingUseCase],
) -> EmbeddingValidationResponse:
    return await use_case(payload)


@router.post('/mcp', response_model=McpValidationResponse)
@inject
async def validate_mcp(
    payload: McpServerSchema,
    use_case: FromDishka[ValidateMcpUseCase],
) -> McpValidationResponse:
    return await use_case(payload)
