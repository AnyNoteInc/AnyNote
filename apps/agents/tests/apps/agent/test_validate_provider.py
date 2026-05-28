from unittest.mock import AsyncMock, MagicMock

from agents.apps.agent.repositories.mcp_client import McpToolDescriptor
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.schemas import McpServerSchema, ModelConfigSchema
from agents.apps.agent.use_cases.validate_provider import ValidateLlmUseCase, ValidateMcpUseCase


async def test_validate_llm_ok() -> None:
    factory = MagicMock(spec=ModelFactoryRepository)
    llm = MagicMock()
    llm.ainvoke = AsyncMock(return_value=MagicMock())
    factory.make.return_value = llm
    uc = ValidateLlmUseCase(model_factory=factory)
    res = await uc(ModelConfigSchema(provider='openai', name='gpt', connection={'apiKey': 'k'}))
    assert res.ok is True
    assert res.error is None


async def test_validate_llm_failure_is_caught() -> None:
    factory = MagicMock(spec=ModelFactoryRepository)
    factory.make.side_effect = RuntimeError('bad key')
    uc = ValidateLlmUseCase(model_factory=factory)
    res = await uc(ModelConfigSchema(provider='openai', name='gpt', connection={'apiKey': 'k'}))
    assert res.ok is False
    assert 'bad key' in (res.error or '')


async def test_validate_mcp_returns_tool_names() -> None:
    client = MagicMock()
    client.list_tools = AsyncMock(return_value=[McpToolDescriptor(name='search', description='', input_schema={})])
    uc = ValidateMcpUseCase(mcp_client=client)
    res = await uc(McpServerSchema(name='probe', url='http://x/mcp'))
    assert res.ok is True
    assert res.tools == ['search']
