from agents.apps.agent.repositories.model_factory import build_reasoning_kwargs
from agents.apps.agent.schemas import (
    ModelConfigSchema,
    ModelConnectionSchema,
    ModelSettingsSchema,
    ReasoningConfigSchema,
)


def cfg(provider: str, name: str) -> ModelConfigSchema:
    return ModelConfigSchema(
        provider=provider,
        name=name,
        connection=ModelConnectionSchema(api_key='x'),
        settings=ModelSettingsSchema(),
    )


def test_openai_effort() -> None:
    kw = build_reasoning_kwargs(cfg('openai', 'gpt-5'), ReasoningConfigSchema(enabled=True, effort='high'))
    assert kw == {'reasoning': {'effort': 'high', 'summary': 'auto'}}


def test_anthropic_budget() -> None:
    kw = build_reasoning_kwargs(
        cfg('anthropic', 'claude-sonnet-4-6'), ReasoningConfigSchema(enabled=True, effort='medium')
    )
    assert kw == {'thinking': {'type': 'enabled', 'budget_tokens': 2000}}


def test_anthropic_opus_adaptive() -> None:
    kw = build_reasoning_kwargs(
        cfg('anthropic', 'claude-opus-4-6'), ReasoningConfigSchema(enabled=True, effort='low')
    )
    assert kw == {'thinking': {'type': 'adaptive'}}


def test_disabled_returns_empty() -> None:
    kw = build_reasoning_kwargs(cfg('openai', 'gpt-5'), ReasoningConfigSchema(enabled=False, effort='low'))
    assert kw == {}


def test_unsupported_provider_returns_empty() -> None:
    kw = build_reasoning_kwargs(cfg('gigachat', 'GigaChat'), ReasoningConfigSchema(enabled=True, effort='high'))
    assert kw == {}
