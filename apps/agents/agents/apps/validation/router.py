"""Provider/MCP validation routes — JWT-protected (internal service token)."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends

from agents.apps.agent.depends import verify_agents_service_token
from agents.apps.agent.schemas import (
    LlmValidationResponseSchema,
    McpServerSchema,
    McpValidationResponseSchema,
    ModelConfigSchema,
)
from agents.apps.agent.use_cases.validate_provider import ValidateLlmUseCase, ValidateMcpUseCase
from agents.apps.processing.schemas import EmbeddingValidationRequestSchema, EmbeddingValidationResponseSchema
from agents.apps.processing.use_cases.validate_embedding import ValidateEmbeddingUseCase

router = APIRouter(prefix='/validation', tags=['Validation'])


@router.post('/llm', response_model=LlmValidationResponseSchema, dependencies=[Depends(verify_agents_service_token)])
@inject
async def validate_llm(
    payload: ModelConfigSchema,
    use_case: FromDishka[ValidateLlmUseCase],
) -> LlmValidationResponseSchema:
    return await use_case(payload)


@router.post(
    '/embedding', response_model=EmbeddingValidationResponseSchema, dependencies=[Depends(verify_agents_service_token)]
)
@inject
async def validate_embedding(
    payload: EmbeddingValidationRequestSchema,
    use_case: FromDishka[ValidateEmbeddingUseCase],
) -> EmbeddingValidationResponseSchema:
    return await use_case(payload)


@router.post('/mcp', response_model=McpValidationResponseSchema, dependencies=[Depends(verify_agents_service_token)])
@inject
async def validate_mcp(
    payload: McpServerSchema,
    use_case: FromDishka[ValidateMcpUseCase],
) -> McpValidationResponseSchema:
    return await use_case(payload)
