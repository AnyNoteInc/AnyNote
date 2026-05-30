import asyncio
from dataclasses import dataclass

from agents.apps.agent.repositories.mcp_client import McpClient
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.schemas import (
    LlmValidationResponseSchema,
    McpServerSchema,
    McpValidationResponseSchema,
    ModelConfigSchema,
)

_LLM_TIMEOUT = 10.0
_MCP_TIMEOUT = 8.0


@dataclass
class ValidateLlmUseCase:
    model_factory: ModelFactoryRepository

    async def __call__(self, config: ModelConfigSchema) -> LlmValidationResponseSchema:
        try:
            llm = self.model_factory.make(config)
            async with asyncio.timeout(_LLM_TIMEOUT):
                await llm.ainvoke('ping')
            return LlmValidationResponseSchema(ok=True)
        except Exception as exc:  # surface provider error to the user
            return LlmValidationResponseSchema(ok=False, error=(str(exc) or f'timed out after {_LLM_TIMEOUT:.0f}s')[:500])


@dataclass
class ValidateMcpUseCase:
    mcp_client: McpClient

    async def __call__(self, server: McpServerSchema) -> McpValidationResponseSchema:
        try:
            # outer timeout is the effective deadline; McpClient's own timeout/retries are capped by it
            async with asyncio.timeout(_MCP_TIMEOUT):
                tools = await self.mcp_client.list_tools(server)
            return McpValidationResponseSchema(ok=True, tools=[t.name for t in tools])
        except Exception as exc:  # surface provider error to the user
            return McpValidationResponseSchema(ok=False, error=(str(exc) or f'timed out after {_MCP_TIMEOUT:.0f}s')[:500])
