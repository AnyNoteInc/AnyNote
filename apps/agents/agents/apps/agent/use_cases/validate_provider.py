from __future__ import annotations

import asyncio
from dataclasses import dataclass

from agents.apps.agent.repositories.mcp_client import McpClient
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.schemas import (
    LlmValidationResponse,
    McpServerSchema,
    McpValidationResponse,
    ModelConfigSchema,
)

_LLM_TIMEOUT = 10.0
_MCP_TIMEOUT = 8.0


@dataclass
class ValidateLlmUseCase:
    model_factory: ModelFactoryRepository

    async def __call__(self, config: ModelConfigSchema) -> LlmValidationResponse:
        try:
            llm = self.model_factory.make(config)
            async with asyncio.timeout(_LLM_TIMEOUT):
                await llm.ainvoke('ping')
            return LlmValidationResponse(ok=True)
        except Exception as exc:  # noqa: BLE001 - surface provider error to the user
            return LlmValidationResponse(ok=False, error=str(exc)[:500])


@dataclass
class ValidateMcpUseCase:
    mcp_client: McpClient

    async def __call__(self, server: McpServerSchema) -> McpValidationResponse:
        try:
            async with asyncio.timeout(_MCP_TIMEOUT):
                tools = await self.mcp_client.list_tools(server)
            return McpValidationResponse(ok=True, tools=[t.name for t in tools])
        except Exception as exc:  # noqa: BLE001
            return McpValidationResponse(ok=False, error=str(exc)[:500])
