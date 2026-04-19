"""Unit tests for the Jinja prompt renderer."""

from __future__ import annotations

import uuid

from agents.schemas.generate import (
    Agent,
    Conversation,
    ConversationMessage,
    GenerateRequest,
    Instructions,
    McpConfig,
    McpServer,
    ModelConfig,
    ModelConnection,
    ModelSettings,
    OutputContract,
    RagContext,
    RagDocument,
    Skill,
    UserRequest,
)
from agents.services.prompt_renderer import JinjaRenderer


def _full_payload() -> GenerateRequest:
    return GenerateRequest(
        thread_id=uuid.uuid4(),
        model=ModelConfig(
            provider="ollama",
            name="gemma4",
            connection=ModelConnection(base_url="http://localhost:11434"),
            settings=ModelSettings(temperature=0.2, max_output_tokens=1024, top_p=1.0),
        ),
        instructions=Instructions(
            system_prompt="Ты помощник",
            app_prompt="Правила apps/web",
            output_contract=OutputContract(
                format="markdown", citations_required=True, language="ru"
            ),
        ),
        rag=RagContext(
            enabled=True,
            documents=[RagDocument(id="d1", title="Doc A", content="Содержимое документа")],
        ),
        conversation=Conversation(
            messages=[
                ConversationMessage(role="user", content="Что такое X?"),
                ConversationMessage(role="assistant", content="Это Y."),
            ],
            summary="Мы обсуждаем X.",
        ),
        skills=[Skill(id="s1", title="Тестовый скилл", markdown="# Skill\n...")],
        agents=[Agent(id="a1", title="Архитектор", markdown="# Agent\n...")],
        mcp=McpConfig(
            servers=[
                McpServer(name="apps-web", description="Built-ins", tools=["search_docs", "get_page"]),
            ]
        ),
        user_request=UserRequest(text="Покажи итоговый пример"),
    )


def test_renderer_contains_core_sections() -> None:
    out = JinjaRenderer().render(_full_payload())
    assert "# ROLE" in out
    assert "# EXECUTION PRIORITY" in out
    assert "# MODEL CONTEXT" in out
    assert "Provider: ollama" in out
    assert "Model: gemma4" in out
    assert "temperature: 0.2" in out
    assert "Ты помощник" in out
    assert "Правила apps/web" in out


def test_renderer_inlines_skills_and_agents() -> None:
    out = JinjaRenderer().render(_full_payload())
    assert "## Skill: Тестовый скилл" in out
    assert "## Agent: Архитектор" in out


def test_renderer_inlines_mcp_servers() -> None:
    out = JinjaRenderer().render(_full_payload())
    assert "## MCP Server: apps-web" in out
    assert "- search_docs" in out
    assert "- get_page" in out


def test_renderer_inlines_rag_documents() -> None:
    out = JinjaRenderer().render(_full_payload())
    assert "## Context Document: Doc A (d1)" in out
    assert "Содержимое документа" in out


def test_renderer_shows_no_context_fallback_when_rag_empty() -> None:
    payload = _full_payload()
    payload.rag = None
    out = JinjaRenderer().render(payload)
    assert "No retrieved context was provided." in out


def test_renderer_includes_user_request() -> None:
    out = JinjaRenderer().render(_full_payload())
    assert "# CURRENT USER REQUEST" in out
    assert "Покажи итоговый пример" in out


def test_renderer_emits_recent_messages_in_order() -> None:
    out = JinjaRenderer().render(_full_payload())
    idx_user = out.index("Что такое X?")
    idx_assistant = out.index("Это Y.")
    assert idx_user < idx_assistant
