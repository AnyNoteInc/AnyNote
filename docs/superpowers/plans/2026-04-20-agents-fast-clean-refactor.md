# apps/agents Fast-clean Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing `apps/agents` service into `yafs`-style structure with `fast-clean` bootstrap, `apps/chat` layered architecture, full provider support (`ollama/openai/gigachat`), Alembic scaffold, and working integration test flow.

**Architecture:** The refactor uses phased cutover: add new package structure and tests first, then port domain logic into `apps/chat` layers (`repositories/services/use_cases`), then switch entrypoints (`bootstrap/router/cmd/rest`) and remove legacy modules. Runtime composition uses FastAPI + Dishka with `fast-clean` integrations at bootstrap level. LangGraph checkpoint tables remain owned by `AsyncPostgresSaver.setup()` and are excluded from Alembic.

**Tech Stack:** Python 3.12, FastAPI, Dishka, LangChain, LangGraph, fast-clean, asyncpg, Alembic, Typer, pytest, httpx, uv.

---

## Scope Check

This spec is a single subsystem (`apps/agents`) and can be implemented in one plan without splitting into separate projects.

## File Structure Map

### New files to create

- `apps/agents/agents/bootstrap.py`: app factory + lifespan + `fast-clean` integration + Dishka setup
- `apps/agents/agents/router.py`: main API router registration entrypoint
- `apps/agents/agents/cmd/__init__.py`: cmd package marker
- `apps/agents/agents/cmd/rest.py`: REST runtime entrypoint (`app = create_app([apply_routes])`)
- `apps/agents/agents/apps/__init__.py`: apps package marker
- `apps/agents/agents/apps/chat/__init__.py`: chat package marker
- `apps/agents/agents/apps/chat/enums.py`: domain enums
- `apps/agents/agents/apps/chat/errors.py`: domain exceptions + handler registration
- `apps/agents/agents/apps/chat/schemas.py`: request/response/stream models
- `apps/agents/agents/apps/chat/depends.py`: Dishka providers for chat unit
- `apps/agents/agents/apps/chat/router.py`: chat APIRouter
- `apps/agents/agents/apps/chat/repositories/__init__.py`: repositories exports
- `apps/agents/agents/apps/chat/repositories/model_factory.py`: chat model factory
- `apps/agents/agents/apps/chat/repositories/prompt_renderer.py`: Jinja prompt renderer
- `apps/agents/agents/apps/chat/repositories/mcp_tools.py`: MCP tool fetch/call adapters
- `apps/agents/agents/apps/chat/services/__init__.py`: services exports
- `apps/agents/agents/apps/chat/services/graph_service.py`: LangGraph pipeline service
- `apps/agents/agents/apps/chat/use_cases/__init__.py`: use cases exports
- `apps/agents/agents/apps/chat/use_cases/generate_stream.py`: generate streaming scenario
- `apps/agents/agents/cli/__init__.py`: CLI package marker
- `apps/agents/agents/cli/app.py`: Typer app object
- `apps/agents/agents/cli/bootstrap.py`: CLI composition
- `apps/agents/agents/cli/commands/__init__.py`: command package marker
- `apps/agents/agents/cli/commands/health.py`: placeholder CLI command
- `apps/agents/.dockerignore`: Docker ignore
- `apps/agents/.gitignore`: Python local ignores
- `apps/agents/.pre-commit-config.yaml`: lint/type checks hooks
- `apps/agents/pytest.ini`: pytest config
- `apps/agents/alembic.ini`: Alembic config
- `apps/agents/cli`: top-level CLI script entrypoint
- `apps/agents/py.typed`: typed marker
- `apps/agents/migrations/env.py`: Alembic env with checkpoint exclusions
- `apps/agents/migrations/script.py.mako`: migration template
- `apps/agents/migrations/README`: migration notes
- `apps/agents/migrations/versions/.gitkeep`: keep versions dir
- `apps/agents/tests/chat/test_schemas.py`: schemas tests
- `apps/agents/tests/chat/test_model_factory.py`: provider factory tests
- `apps/agents/tests/chat/test_prompt_renderer.py`: prompt rendering tests
- `apps/agents/tests/chat/test_mcp_tools.py`: MCP tools tests
- `apps/agents/tests/chat/test_graph_service.py`: graph tests
- `apps/agents/tests/chat/test_generate_stream_use_case.py`: use-case tests
- `apps/agents/tests/chat/test_router.py`: router/auth/SSE tests
- `apps/agents/tests/test_bootstrap.py`: bootstrap wiring tests
- `apps/agents/tests/test_cmd_rest.py`: REST entrypoint tests
- `apps/agents/tests/test_cli.py`: CLI bootstrap tests
- `apps/agents/tests/test_alembic_env.py`: Alembic checkpoint exclusion tests

### Existing files to modify

- `apps/agents/agents/settings.py`: add settings for `fast-clean` hooks (debug, cors, sentry)
- `apps/agents/agents/__init__.py`: export app package metadata if needed
- `apps/agents/agents/prompts/default.j2`: keep prompt template location used by new renderer
- `apps/agents/package.json`: use new entrypoint + scripts for integration marker run
- `apps/agents/pyproject.toml`: add `fast-clean`, `alembic`, `typer`, update tool configs
- `apps/agents/Makefile`: align with new commands and Alembic helpers
- `apps/agents/Dockerfile`: run `agents.cmd.rest:app`
- `apps/agents/README.md`: update architecture and runbook
- `apps/agents/tests/conftest.py`: update env defaults and fixtures for new settings
- `apps/agents/tests/test_generate_ollama.py`: move/adjust to new architecture

### Existing files/dirs to remove after cutover

- `apps/agents/agents/main.py`
- `apps/agents/agents/exceptions.py`
- `apps/agents/agents/di/`
- `apps/agents/agents/entrypoints/`
- `apps/agents/agents/services/`
- `apps/agents/agents/schemas/`

---

### Task 1: Create New Package Skeleton and Entrypoint Smoke Test

**Files:**
- Create: `apps/agents/tests/test_cmd_rest.py`
- Create: `apps/agents/agents/cmd/__init__.py`
- Create: `apps/agents/agents/cmd/rest.py`
- Create: `apps/agents/agents/apps/__init__.py`
- Create: `apps/agents/agents/apps/chat/__init__.py`

- [ ] **Step 1: Write the failing import smoke test**

```python
# apps/agents/tests/test_cmd_rest.py
from __future__ import annotations

from importlib import import_module


def test_cmd_rest_exports_fastapi_app() -> None:
    module = import_module("agents.cmd.rest")
    assert hasattr(module, "app")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && uv run pytest tests/test_cmd_rest.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.cmd'`.

- [ ] **Step 3: Create minimal packages and `cmd/rest.py`**

```python
# apps/agents/agents/cmd/rest.py
from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="AnyNote Agents")
```

```python
# apps/agents/agents/cmd/__init__.py
"""Command entrypoints for agents."""
```

```python
# apps/agents/agents/apps/__init__.py
"""Domain application modules."""
```

```python
# apps/agents/agents/apps/chat/__init__.py
"""Chat domain package."""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/agents && uv run pytest tests/test_cmd_rest.py -q`
Expected: PASS (`1 passed`).

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/test_cmd_rest.py \
  apps/agents/agents/cmd/__init__.py \
  apps/agents/agents/cmd/rest.py \
  apps/agents/agents/apps/__init__.py \
  apps/agents/agents/apps/chat/__init__.py
git commit -m "test(agents): add cmd/rest smoke test and package skeleton"
```

### Task 2: Port Chat Schemas, Enums, Errors into `apps/chat`

**Files:**
- Create: `apps/agents/tests/chat/test_schemas.py`
- Create: `apps/agents/agents/apps/chat/enums.py`
- Create: `apps/agents/agents/apps/chat/errors.py`
- Create: `apps/agents/agents/apps/chat/schemas.py`

- [ ] **Step 1: Write failing schemas/error tests**

```python
# apps/agents/tests/chat/test_schemas.py
from __future__ import annotations

import pytest
from pydantic import ValidationError

from agents.apps.chat.errors import InvalidPayloadError
from agents.apps.chat.schemas import GenerateRequest, ServerEvent


def test_generate_request_rejects_blank_text() -> None:
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(
            {
                "threadId": "adf9f5bf-1679-421d-9f34-8f8fc2d2f542",
                "model": {"provider": "ollama", "name": "gemma4"},
                "conversation": {"messages": []},
                "userRequest": {"text": "   "},
            }
        )


def test_server_event_token_shape() -> None:
    event = ServerEvent.token("hello")
    assert event.model_dump() == {"type": "token", "text": "hello"}


def test_invalid_payload_error_status_code() -> None:
    error = InvalidPayloadError("bad payload")
    assert error.http_status == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && uv run pytest tests/chat/test_schemas.py -q`
Expected: FAIL with import errors for `agents.apps.chat.schemas` and `agents.apps.chat.errors`.

- [ ] **Step 3: Implement schemas/enums/errors**

```python
# apps/agents/agents/apps/chat/enums.py
from __future__ import annotations

from enum import StrEnum


class ModelProvider(StrEnum):
    OLLAMA = "ollama"
    OPENAI = "openai"
    GIGACHAT = "gigachat"
```

```python
# apps/agents/agents/apps/chat/errors.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class AgentException(Exception):
    code: str
    message: str
    http_status: int

    def __str__(self) -> str:
        return self.message


class InvalidPayloadError(AgentException):
    def __init__(self, message: str) -> None:
        super().__init__(code="INVALID_PAYLOAD", message=message, http_status=422)


class ProviderError(AgentException):
    def __init__(self, message: str, *, code: str = "PROVIDER_ERROR") -> None:
        super().__init__(code=code, message=message, http_status=502)


class UnauthorizedError(AgentException):
    def __init__(self) -> None:
        super().__init__(code="UNAUTHORIZED", message="Invalid bearer token", http_status=401)
```

```python
# apps/agents/agents/apps/chat/schemas.py
from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from .enums import ModelProvider


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class ModelConnection(CamelModel):
    base_url: str | None = None
    api_key: str | None = None
    organization: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scope: str | None = None


class ModelSettings(CamelModel):
    temperature: float | None = None
    max_output_tokens: int | None = None
    top_p: float | None = None


class ModelConfig(CamelModel):
    provider: ModelProvider
    name: str
    connection: ModelConnection = Field(default_factory=ModelConnection)
    settings: ModelSettings = Field(default_factory=ModelSettings)


class ConversationMessage(CamelModel):
    role: Literal["user", "assistant"]
    content: str


class Conversation(CamelModel):
    messages: list[ConversationMessage] = Field(default_factory=list)
    max_history_tokens: int | None = None
    summary: str | None = None


class McpServer(CamelModel):
    name: str
    description: str = ""
    url: str | None = None
    auth_header: str | None = None
    tools: list[str] = Field(default_factory=list)


class McpConfig(CamelModel):
    servers: list[McpServer] = Field(default_factory=list)


class UserRequest(CamelModel):
    text: str

    @field_validator("text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("userRequest.text must not be blank")
        return value


class GenerateRequest(CamelModel):
    thread_id: UUID
    model: ModelConfig
    conversation: Conversation = Field(default_factory=Conversation)
    mcp: McpConfig | None = None
    user_request: UserRequest


class ServerEvent(CamelModel):
    type: Literal["token", "done", "error"]
    text: str | None = None
    code: str | None = None
    message: str | None = None

    @classmethod
    def token(cls, text: str) -> "ServerEvent":
        return cls(type="token", text=text)

    @classmethod
    def done(cls) -> "ServerEvent":
        return cls(type="done")

    @classmethod
    def error(cls, code: str, message: str) -> "ServerEvent":
        return cls(type="error", code=code, message=message)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/agents && uv run pytest tests/chat/test_schemas.py -q`
Expected: PASS (`3 passed`).

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/chat/test_schemas.py \
  apps/agents/agents/apps/chat/enums.py \
  apps/agents/agents/apps/chat/errors.py \
  apps/agents/agents/apps/chat/schemas.py
git commit -m "feat(agents): add chat schemas enums and errors"
```

### Task 3: Move Provider Factory and Prompt Renderer to Repositories

**Files:**
- Create: `apps/agents/tests/chat/test_model_factory.py`
- Create: `apps/agents/tests/chat/test_prompt_renderer.py`
- Create: `apps/agents/agents/apps/chat/repositories/__init__.py`
- Create: `apps/agents/agents/apps/chat/repositories/model_factory.py`
- Create: `apps/agents/agents/apps/chat/repositories/prompt_renderer.py`
- Modify: `apps/agents/agents/prompts/default.j2`

- [ ] **Step 1: Write failing repository tests**

```python
# apps/agents/tests/chat/test_model_factory.py
from __future__ import annotations

from agents.apps.chat.repositories.model_factory import create_chat_model
from agents.apps.chat.schemas import ModelConfig


def test_create_ollama_model() -> None:
    config = ModelConfig.model_validate({"provider": "ollama", "name": "gemma4"})
    model = create_chat_model(config)
    assert model.__class__.__name__ == "ChatOllama"


def test_create_openai_model() -> None:
    config = ModelConfig.model_validate(
        {
            "provider": "openai",
            "name": "gpt-4o-mini",
            "connection": {"apiKey": "sk-test"},
        }
    )
    model = create_chat_model(config)
    assert model.__class__.__name__ == "ChatOpenAI"


def test_create_gigachat_model() -> None:
    config = ModelConfig.model_validate(
        {
            "provider": "gigachat",
            "name": "GigaChat-2",
            "connection": {"clientId": "id", "clientSecret": "secret"},
        }
    )
    model = create_chat_model(config)
    assert model.__class__.__name__ == "GigaChat"
```

```python
# apps/agents/tests/chat/test_prompt_renderer.py
from __future__ import annotations

from agents.apps.chat.repositories.prompt_renderer import JinjaRenderer
from agents.apps.chat.schemas import GenerateRequest


def test_prompt_renderer_includes_user_request() -> None:
    payload = GenerateRequest.model_validate(
        {
            "threadId": "adf9f5bf-1679-421d-9f34-8f8fc2d2f542",
            "model": {"provider": "ollama", "name": "gemma4"},
            "conversation": {"messages": []},
            "userRequest": {"text": "hello"},
        }
    )
    rendered = JinjaRenderer().render(payload)
    assert "hello" in rendered
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/agents && uv run pytest tests/chat/test_model_factory.py tests/chat/test_prompt_renderer.py -q`
Expected: FAIL with missing repository modules.

- [ ] **Step 3: Implement model factory and prompt renderer**

```python
# apps/agents/agents/apps/chat/repositories/model_factory.py
from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langchain_gigachat.chat_models import GigaChat
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from agents.apps.chat.errors import InvalidPayloadError
from agents.apps.chat.schemas import ModelConfig


def create_chat_model(config: ModelConfig) -> BaseChatModel:
    temperature = config.settings.temperature if config.settings.temperature is not None else 0.2
    max_tokens = config.settings.max_output_tokens

    if config.provider == "ollama":
        base_url = config.connection.base_url or "http://localhost:11434"
        return ChatOllama(model=config.name, base_url=base_url, temperature=temperature)

    if config.provider == "openai":
        return ChatOpenAI(
            model=config.name,
            api_key=config.connection.api_key,
            organization=config.connection.organization,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if config.provider == "gigachat":
        credentials = f"{config.connection.client_id}:{config.connection.client_secret}"
        return GigaChat(
            credentials=credentials,
            scope=config.connection.scope or "GIGACHAT_API_PERS",
            model=config.name,
            temperature=temperature,
        )

    raise InvalidPayloadError(f"Unknown provider: {config.provider!r}")
```

```python
# apps/agents/agents/apps/chat/repositories/prompt_renderer.py
from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from agents.apps.chat.schemas import GenerateRequest


class JinjaRenderer:
    def __init__(self) -> None:
        prompts_dir = Path(__file__).resolve().parents[3] / "prompts"
        self._env = Environment(loader=FileSystemLoader(prompts_dir), autoescape=False)

    def render(self, payload: GenerateRequest) -> str:
        template = self._env.get_template("default.j2")
        return template.render(payload=payload)
```

```python
# apps/agents/agents/apps/chat/repositories/__init__.py
from .model_factory import create_chat_model
from .prompt_renderer import JinjaRenderer

__all__ = ["create_chat_model", "JinjaRenderer"]
```

```jinja2
{# apps/agents/agents/prompts/default.j2 #}
{{ payload.user_request.text }}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agents && uv run pytest tests/chat/test_model_factory.py tests/chat/test_prompt_renderer.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/chat/test_model_factory.py \
  apps/agents/tests/chat/test_prompt_renderer.py \
  apps/agents/agents/apps/chat/repositories/__init__.py \
  apps/agents/agents/apps/chat/repositories/model_factory.py \
  apps/agents/agents/apps/chat/repositories/prompt_renderer.py \
  apps/agents/agents/prompts/default.j2
git commit -m "feat(agents): move provider factory and prompt renderer to chat repositories"
```

### Task 4: Move MCP Tool Adapter and Graph Service

**Files:**
- Create: `apps/agents/tests/chat/test_mcp_tools.py`
- Create: `apps/agents/tests/chat/test_graph_service.py`
- Create: `apps/agents/agents/apps/chat/repositories/mcp_tools.py`
- Create: `apps/agents/agents/apps/chat/services/__init__.py`
- Create: `apps/agents/agents/apps/chat/services/graph_service.py`

- [ ] **Step 1: Write failing MCP/graph tests**

```python
# apps/agents/tests/chat/test_mcp_tools.py
from __future__ import annotations

import pytest

from agents.apps.chat.repositories.mcp_tools import fetch_mcp_tools
from agents.apps.chat.schemas import McpServer


@pytest.mark.asyncio
async def test_fetch_mcp_tools_returns_empty_for_unreachable() -> None:
    tools = await fetch_mcp_tools([McpServer(name="x", url="http://127.0.0.1:1")])
    assert tools == []
```

```python
# apps/agents/tests/chat/test_graph_service.py
from __future__ import annotations

from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver

from agents.apps.chat.repositories.prompt_renderer import JinjaRenderer
from agents.apps.chat.services.graph_service import build_graph


class DummyCheckpointer(BaseCheckpointSaver[str]):
    async def aget_tuple(self, config: Any) -> Any:  # pragma: no cover - test double
        return None

    async def alist(self, config: Any, *, limit: int | None = None, before: Any = None) -> Any:  # pragma: no cover
        return []

    async def aput(self, config: Any, checkpoint: Any, metadata: Any, new_versions: Any) -> Any:  # pragma: no cover
        return config

    async def aput_writes(self, config: Any, writes: Any, task_id: str, task_path: str = "") -> None:  # pragma: no cover
        return None


def test_build_graph_returns_compiled_graph() -> None:
    graph = build_graph(renderer=JinjaRenderer(), checkpointer=DummyCheckpointer())
    assert hasattr(graph, "astream")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/agents && uv run pytest tests/chat/test_mcp_tools.py tests/chat/test_graph_service.py -q`
Expected: FAIL with missing modules and fixtures.

- [ ] **Step 3: Implement MCP repository and graph service**

```python
# apps/agents/agents/apps/chat/repositories/mcp_tools.py
from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

from agents.apps.chat.schemas import McpServer

log = logging.getLogger(__name__)


def _json_type_to_python(json_type: str | None) -> type[Any]:
    return {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "array": list,
        "object": dict,
    }.get(json_type or "", str)


def _argument_schema(tool: dict[str, Any]) -> type[BaseModel]:
    schema_name = f"{tool.get('name', 'McpTool')}Args"
    input_schema = tool.get("inputSchema") or {}
    properties: dict[str, Any] = input_schema.get("properties") or {}
    required = set(input_schema.get("required") or [])
    fields: dict[str, Any] = {}
    for prop_name, spec in properties.items():
        py_type = _json_type_to_python(spec.get("type"))
        default: Any = ... if prop_name in required else None
        fields[prop_name] = (py_type | None, Field(default, description=spec.get("description")))
    return create_model(schema_name, **fields) if fields else create_model(schema_name)


async def _post_mcp(client: httpx.AsyncClient, server: McpServer, payload: dict[str, Any]) -> Any:
    if not server.url:
        raise RuntimeError(f"MCP server {server.name} has no url")
    headers = {"content-type": "application/json", "accept": "application/json"}
    if server.auth_header:
        headers["authorization"] = server.auth_header
    resp = await client.post(server.url, json=payload, headers=headers, timeout=30.0)
    resp.raise_for_status()
    body = resp.json()
    if isinstance(body, dict) and body.get("error"):
        raise RuntimeError(f"MCP error: {body['error']}")
    return body.get("result") if isinstance(body, dict) else body


def _make_async_runner(coroutine: Callable[..., Any]) -> Callable[..., Any]:
    return coroutine


def _wrap_tool(server: McpServer, entry: dict[str, Any]) -> StructuredTool:
    name = str(entry.get("name") or "unnamed")
    description = str(entry.get("description") or f"MCP tool {name} on {server.name}")
    args_schema = _argument_schema(entry)

    async def call(**kwargs: Any) -> str:
        async with httpx.AsyncClient() as client:
            result = await _post_mcp(
                client,
                server,
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": kwargs},
                },
            )
        if isinstance(result, dict) and "content" in result:
            chunks = result.get("content") or []
            text = "\n".join(
                str(item.get("text", ""))
                for item in chunks
                if isinstance(item, dict) and item.get("type") == "text"
            )
            return text or json.dumps(result, ensure_ascii=False)
        return json.dumps(result, ensure_ascii=False)

    return StructuredTool.from_function(
        coroutine=_make_async_runner(call),
        name=name,
        description=description,
        args_schema=args_schema,
    )


async def fetch_mcp_tools(servers: list[McpServer]) -> list[StructuredTool]:
    tools: list[StructuredTool] = []
    if not servers:
        return tools
    async with httpx.AsyncClient() as client:
        for server in servers:
            try:
                listed = await _post_mcp(
                    client,
                    server,
                    {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("MCP server %s unreachable: %s", server.name, exc)
                continue
            for entry in listed.get("tools", []) if isinstance(listed, dict) else []:
                tools.append(_wrap_tool(server, entry))
    return tools
```

```python
# apps/agents/agents/apps/chat/services/graph_service.py
from __future__ import annotations

from collections.abc import Callable
from typing import TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from agents.apps.chat.repositories.mcp_tools import fetch_mcp_tools
from agents.apps.chat.repositories.model_factory import create_chat_model
from agents.apps.chat.repositories.prompt_renderer import JinjaRenderer
from agents.apps.chat.schemas import GenerateRequest, ModelConfig


class GraphState(TypedDict, total=False):
    payload: GenerateRequest
    messages: list[BaseMessage]
    response_text: str
    tools: list[StructuredTool]


LlmFactory = Callable[[ModelConfig], BaseChatModel]
CompiledGraph = CompiledStateGraph[GraphState, None, GraphState, GraphState]


def build_graph(
    *,
    renderer: JinjaRenderer,
    checkpointer: BaseCheckpointSaver[str],
    llm_factory: LlmFactory = create_chat_model,
) -> CompiledGraph:
    async def prepare_prompt(state: GraphState) -> GraphState:
        payload = state["payload"]
        system_prompt = renderer.render(payload)
        messages: list[BaseMessage] = [SystemMessage(content=system_prompt)]
        for msg in payload.conversation.messages:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            else:
                messages.append(AIMessage(content=msg.content))
        messages.append(HumanMessage(content=payload.user_request.text))
        servers = payload.mcp.servers if payload.mcp else []
        tools = await fetch_mcp_tools([server for server in servers if server.url])
        return {"messages": messages, "tools": tools}

    async def llm(state: GraphState) -> GraphState:
        payload = state["payload"]
        model = llm_factory(payload.model)
        bound = model.bind_tools(state.get("tools") or []) if state.get("tools") else model
        result = await bound.ainvoke(state["messages"])
        text = result.content if isinstance(result.content, str) else str(result.content)
        return {"messages": [*state["messages"], result], "response_text": text}

    async def tools_node(state: GraphState) -> GraphState:
        last = state["messages"][-1]
        tool_calls = getattr(last, "tool_calls", None) or []
        registered = {tool.name: tool for tool in state.get("tools") or []}
        additions: list[BaseMessage] = []
        for call in tool_calls:
            name = call["name"] if isinstance(call, dict) else call.name
            args = call["args"] if isinstance(call, dict) else call.args
            call_id = call["id"] if isinstance(call, dict) else call.id
            tool = registered.get(name)
            if tool is None:
                content = f"tool '{name}' is not registered"
            else:
                try:
                    content = await tool.ainvoke(args)
                except Exception as exc:  # noqa: BLE001
                    content = f"tool '{name}' raised: {exc}"
            additions.append(ToolMessage(content=str(content), tool_call_id=call_id))
        return {"messages": [*state["messages"], *additions]}

    def route_after_llm(state: GraphState) -> str:
        last = state["messages"][-1]
        tool_calls = getattr(last, "tool_calls", None) or []
        if tool_calls and state.get("tools"):
            return "tools"
        return END

    graph: StateGraph[GraphState, None, GraphState, GraphState] = StateGraph(GraphState)
    graph.add_node("prepare_prompt", prepare_prompt)
    graph.add_node("llm", llm)
    graph.add_node("tools", tools_node)
    graph.add_edge(START, "prepare_prompt")
    graph.add_edge("prepare_prompt", "llm")
    graph.add_conditional_edges("llm", route_after_llm, {"tools": "tools", END: END})
    graph.add_edge("tools", "llm")
    return graph.compile(checkpointer=checkpointer)
```

```python
# apps/agents/agents/apps/chat/services/__init__.py
from .graph_service import CompiledGraph, GraphState, build_graph

__all__ = ["CompiledGraph", "GraphState", "build_graph"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agents && uv run pytest tests/chat/test_mcp_tools.py tests/chat/test_graph_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/chat/test_mcp_tools.py \
  apps/agents/tests/chat/test_graph_service.py \
  apps/agents/agents/apps/chat/repositories/mcp_tools.py \
  apps/agents/agents/apps/chat/services/__init__.py \
  apps/agents/agents/apps/chat/services/graph_service.py
git commit -m "feat(agents): port mcp adapters and graph service into chat module"
```

### Task 5: Add Generate Use Case and Chat Router

**Files:**
- Create: `apps/agents/tests/chat/test_generate_stream_use_case.py`
- Create: `apps/agents/tests/chat/test_router.py`
- Create: `apps/agents/agents/apps/chat/use_cases/__init__.py`
- Create: `apps/agents/agents/apps/chat/use_cases/generate_stream.py`
- Create: `apps/agents/agents/apps/chat/router.py`

- [ ] **Step 1: Write failing use-case/router tests**

```python
# apps/agents/tests/chat/test_generate_stream_use_case.py
from __future__ import annotations

import json

import pytest

from agents.apps.chat.schemas import ServerEvent
from agents.apps.chat.use_cases.generate_stream import normalize_event


@pytest.mark.asyncio
async def test_normalize_event_maps_token_message() -> None:
    payload = normalize_event(ServerEvent.token("x"))
    assert json.loads(payload)["type"] == "token"
```

```python
# apps/agents/tests/chat/test_router.py
from __future__ import annotations

from agents.apps.chat.router import router


def test_router_registers_generate_endpoint() -> None:
    assert any(route.path == "/api/v1/generate" for route in router.routes)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/agents && uv run pytest tests/chat/test_generate_stream_use_case.py tests/chat/test_router.py -q`
Expected: FAIL with missing use-case/router modules.

- [ ] **Step 3: Implement use-case and router**

```python
# apps/agents/agents/apps/chat/use_cases/generate_stream.py
from __future__ import annotations

from collections.abc import AsyncIterator

from langchain_core.messages import AIMessageChunk
from langchain_core.runnables import RunnableConfig

from agents.apps.chat.errors import ProviderError
from agents.apps.chat.schemas import GenerateRequest, ServerEvent
from agents.apps.chat.services import CompiledGraph, GraphState


def normalize_event(event: ServerEvent) -> str:
    return event.model_dump_json()


class GenerateStreamUseCase:
    def __init__(self, graph: CompiledGraph) -> None:
        self._graph = graph

    async def __call__(self, payload: GenerateRequest) -> AsyncIterator[str]:
        config: RunnableConfig = {"configurable": {"thread_id": str(payload.thread_id)}}
        initial_state: GraphState = {"payload": payload}
        try:
            async for mode, chunk in self._graph.astream(initial_state, config, stream_mode=["messages"]):
                if mode != "messages":
                    continue
                if not (isinstance(chunk, tuple) and len(chunk) == 2):
                    continue
                message, _meta = chunk
                if isinstance(message, AIMessageChunk) and isinstance(message.content, str) and message.content:
                    yield normalize_event(ServerEvent.token(message.content))
            yield normalize_event(ServerEvent.done())
        except ProviderError as exc:
            yield normalize_event(ServerEvent.error(exc.code, str(exc)))
        except Exception as exc:  # noqa: BLE001
            yield normalize_event(ServerEvent.error("INTERNAL_ERROR", str(exc)))
```

```python
# apps/agents/agents/apps/chat/router.py
from __future__ import annotations

from collections.abc import AsyncIterator

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, Header
from sse_starlette.sse import EventSourceResponse

from agents.apps.chat.errors import UnauthorizedError
from agents.apps.chat.schemas import GenerateRequest
from agents.apps.chat.use_cases.generate_stream import GenerateStreamUseCase
from agents.settings import Settings

router = APIRouter(prefix="/api/v1", tags=["chat"])


@inject
def require_bearer(
    settings: FromDishka[Settings],
    authorization: str | None = Header(default=None),
) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedError()
    token = authorization.removeprefix("Bearer ").strip()
    if token != settings.agents_service_token:
        raise UnauthorizedError()


@router.post("/generate", dependencies=[Depends(require_bearer)])
@inject
async def generate(
    body: GenerateRequest,
    use_case: FromDishka[GenerateStreamUseCase],
) -> EventSourceResponse:
    async def stream() -> AsyncIterator[dict[str, str]]:
        async for payload in use_case(body):
            yield {"data": payload}

    return EventSourceResponse(stream(), ping=15)
```

```python
# apps/agents/agents/apps/chat/use_cases/__init__.py
from .generate_stream import GenerateStreamUseCase

__all__ = ["GenerateStreamUseCase"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agents && uv run pytest tests/chat/test_generate_stream_use_case.py tests/chat/test_router.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/chat/test_generate_stream_use_case.py \
  apps/agents/tests/chat/test_router.py \
  apps/agents/agents/apps/chat/use_cases/__init__.py \
  apps/agents/agents/apps/chat/use_cases/generate_stream.py \
  apps/agents/agents/apps/chat/router.py
git commit -m "feat(agents): add generate stream use case and chat router"
```

### Task 6: Add Dishka Providers, Bootstrap, Main Router, REST Entrypoint

**Files:**
- Create: `apps/agents/tests/test_bootstrap.py`
- Create: `apps/agents/agents/apps/chat/depends.py`
- Create: `apps/agents/agents/bootstrap.py`
- Create: `apps/agents/agents/router.py`
- Modify: `apps/agents/agents/cmd/rest.py`
- Modify: `apps/agents/agents/settings.py`

- [ ] **Step 1: Write failing bootstrap test**

```python
# apps/agents/tests/test_bootstrap.py
from __future__ import annotations

from fastapi import FastAPI

from agents.bootstrap import create_app
from agents.router import apply_routes


def test_create_app_registers_routes() -> None:
    app = create_app([apply_routes])
    paths = {route.path for route in app.routes}
    assert "/api/v1/generate" in paths
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && uv run pytest tests/test_bootstrap.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.bootstrap'`.

- [ ] **Step 3: Implement providers + bootstrap + router + cmd wiring**

```python
# apps/agents/agents/apps/chat/depends.py
from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg
from dishka import Provider, Scope, from_context, provide
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agents.apps.chat.repositories import JinjaRenderer
from agents.apps.chat.services import CompiledGraph, build_graph
from agents.apps.chat.use_cases import GenerateStreamUseCase
from agents.settings import Settings


class ChatAppProvider(Provider):
    scope = Scope.APP
    settings = from_context(provides=Settings, scope=Scope.APP)

    @provide
    async def pool(self, settings: Settings) -> AsyncIterator[asyncpg.Pool]:
        pool = await asyncpg.create_pool(settings.agents_database_url)
        try:
            yield pool
        finally:
            await pool.close()

    @provide
    async def checkpointer(self, settings: Settings) -> AsyncIterator[AsyncPostgresSaver]:
        async with AsyncPostgresSaver.from_conn_string(settings.agents_database_url) as saver:
            await saver.setup()
            yield saver


class ChatSingletonProvider(Provider):
    scope = Scope.APP

    @provide
    def renderer(self) -> JinjaRenderer:
        return JinjaRenderer()

    @provide
    def graph(self, renderer: JinjaRenderer, checkpointer: AsyncPostgresSaver) -> CompiledGraph:
        return build_graph(renderer=renderer, checkpointer=checkpointer)


class ChatRequestProvider(Provider):
    scope = Scope.REQUEST

    @provide
    def generate_stream_use_case(self, graph: CompiledGraph) -> GenerateStreamUseCase:
        return GenerateStreamUseCase(graph)
```

```python
# apps/agents/agents/bootstrap.py
from __future__ import annotations

from collections.abc import Callable, Iterable
from contextlib import asynccontextmanager

from dishka import AsyncContainer, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from agents.apps.chat.depends import ChatAppProvider, ChatRequestProvider, ChatSingletonProvider
from agents.apps.chat.errors import AgentException
from agents.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    container = getattr(app.state, "dishka_container", None)
    if isinstance(container, AsyncContainer):
        await container.close()


def _agent_exception_handler(_request: Request, exc: AgentException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"error": {"code": exc.code, "message": str(exc)}},
    )


def create_app(use_routes: Iterable[Callable[[FastAPI], None]]) -> FastAPI:
    settings = Settings()
    app = FastAPI(title="AnyNote Agents", version="0.1.0", lifespan=lifespan)

    container = make_async_container(
        ChatAppProvider(),
        ChatSingletonProvider(),
        ChatRequestProvider(),
        context={Settings: settings},
    )
    app.state.dishka_container = container
    setup_dishka(container=container, app=app)

    app.add_exception_handler(AgentException, _agent_exception_handler)  # type: ignore[arg-type]

    for use_route in use_routes:
        use_route(app)

    return app
```

```python
# apps/agents/agents/router.py
from __future__ import annotations

from fastapi import APIRouter, FastAPI

from agents.apps.chat.router import router as chat_router

health_router = APIRouter(tags=["health"])


@health_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def apply_routes(app: FastAPI) -> None:
    app.include_router(health_router)
    app.include_router(chat_router)
```

```python
# apps/agents/agents/cmd/rest.py
from __future__ import annotations

from agents.bootstrap import create_app
from agents.router import apply_routes

app = create_app([apply_routes])
```

```python
# apps/agents/agents/settings.py
from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", populate_by_name=True)

    agents_database_url: str = Field(alias="AGENTS_DATABASE_URL")
    agents_service_token: str = Field(alias="AGENTS_SERVICE_TOKEN")
    agents_log_level: str = Field(default="INFO", alias="AGENTS_LOG_LEVEL")

    debug: bool = Field(default=False, alias="DEBUG")
    cors_origins: list[str] = Field(default_factory=list, alias="CORS_ORIGINS")
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")

    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_default_model: str = Field(default="gemma4", alias="OLLAMA_DEFAULT_MODEL")
```

- [ ] **Step 4: Run bootstrap test to verify it passes**

Run: `cd apps/agents && uv run pytest tests/test_bootstrap.py tests/test_cmd_rest.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/test_bootstrap.py \
  apps/agents/agents/apps/chat/depends.py \
  apps/agents/agents/bootstrap.py \
  apps/agents/agents/router.py \
  apps/agents/agents/cmd/rest.py \
  apps/agents/agents/settings.py
git commit -m "feat(agents): wire dishka providers bootstrap router and cmd rest"
```

### Task 7: Integrate `fast-clean` in Bootstrap and Add CLI Scaffold

**Files:**
- Create: `apps/agents/tests/test_cli.py`
- Create: `apps/agents/agents/cli/__init__.py`
- Create: `apps/agents/agents/cli/bootstrap.py`
- Create: `apps/agents/agents/cli/app.py`
- Create: `apps/agents/agents/cli/commands/__init__.py`
- Create: `apps/agents/agents/cli/commands/health.py`
- Create: `apps/agents/cli`
- Modify: `apps/agents/agents/bootstrap.py`
- Modify: `apps/agents/pyproject.toml`

- [ ] **Step 1: Write failing CLI test**

```python
# apps/agents/tests/test_cli.py
from __future__ import annotations

from typer.testing import CliRunner

from agents.cli.app import app


def test_cli_help() -> None:
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "AnyNote Agents CLI" in result.stdout
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && uv run pytest tests/test_cli.py -q`
Expected: FAIL with import error for `agents.cli.app`.

- [ ] **Step 3: Implement CLI scaffold and add `fast-clean` bootstrap calls**

```python
# apps/agents/agents/cli/commands/health.py
from __future__ import annotations


def health() -> None:
    print("agents-cli-ok")
```

```python
# apps/agents/agents/cli/bootstrap.py
from __future__ import annotations

import typer

from agents.cli.commands.health import health


def create_app() -> typer.Typer:
    app = typer.Typer(help="AnyNote Agents CLI")
    app.command(name="health")(health)
    return app
```

```python
# apps/agents/agents/cli/app.py
from __future__ import annotations

from agents.cli.bootstrap import create_app

app = create_app()
```

```python
# apps/agents/agents/cli/__init__.py
"""CLI package for agents."""
```

```python
# apps/agents/agents/cli/commands/__init__.py
"""CLI commands package."""
```

```python
# apps/agents/agents/bootstrap.py
from __future__ import annotations

from collections.abc import Callable, Iterable
from contextlib import asynccontextmanager

from dishka import AsyncContainer, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fast_clean.contrib.monitoring import use_monitoring
from fast_clean.contrib.sentry.sentry import use_sentry
from fast_clean.exceptions import use_exceptions_handlers
from fast_clean.loggers import use_logging
from fast_clean.middleware import use_middleware
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from agents.apps.chat.depends import ChatAppProvider, ChatRequestProvider, ChatSingletonProvider
from agents.apps.chat.errors import AgentException
from agents.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    container = getattr(app.state, "dishka_container", None)
    if isinstance(container, AsyncContainer):
        await container.close()


def _agent_exception_handler(_request: Request, exc: AgentException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"error": {"code": exc.code, "message": str(exc)}},
    )


def create_app(use_routes: Iterable[Callable[[FastAPI], None]]) -> FastAPI:
    settings = Settings()
    app = FastAPI(title="AnyNote Agents", version="0.1.0", lifespan=lifespan, debug=settings.debug)

    use_logging(settings)
    use_sentry(settings.sentry_dsn)
    use_middleware(app, settings.cors_origins)
    use_monitoring(app, app_name="agents")
    use_exceptions_handlers(app, settings)

    container = make_async_container(
        ChatAppProvider(),
        ChatSingletonProvider(),
        ChatRequestProvider(),
        context={Settings: settings},
    )
    app.state.dishka_container = container
    setup_dishka(container=container, app=app)
    app.add_exception_handler(AgentException, _agent_exception_handler)  # type: ignore[arg-type]

    for use_route in use_routes:
        use_route(app)

    return app
```

```toml
# apps/agents/pyproject.toml (dependencies excerpt)
dependencies = [
    "fastapi[standard]>=0.116",
    "fast-clean>=1.6.0",
    "typer>=0.15",
    "alembic>=1.14",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
    "dishka>=1.4",
    "httpx>=0.27",
    "langchain>=0.3",
    "langchain-core>=0.3",
    "langchain-ollama>=0.2",
    "langchain-openai>=0.2",
    "langchain-gigachat>=0.3",
    "langgraph>=0.2",
    "langgraph-checkpoint-postgres>=2.0",
    "asyncpg>=0.30",
    "jinja2>=3.1",
    "sse-starlette>=2.1",
    "psycopg[binary]>=3.2",
]
```

```python
# apps/agents/cli
from agents.cli.app import app

if __name__ == "__main__":
    app()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agents && uv run pytest tests/test_cli.py tests/test_bootstrap.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/test_cli.py \
  apps/agents/agents/cli/__init__.py \
  apps/agents/agents/cli/bootstrap.py \
  apps/agents/agents/cli/app.py \
  apps/agents/agents/cli/commands/__init__.py \
  apps/agents/agents/cli/commands/health.py \
  apps/agents/cli \
  apps/agents/agents/bootstrap.py \
  apps/agents/pyproject.toml
git commit -m "feat(agents): integrate fast-clean bootstrap hooks and cli scaffold"
```

### Task 8: Add Project Infra Files and Build/Run Script Alignment

**Files:**
- Create: `apps/agents/tests/test_scripts.py`
- Create: `apps/agents/.dockerignore`
- Create: `apps/agents/.gitignore`
- Create: `apps/agents/.pre-commit-config.yaml`
- Create: `apps/agents/pytest.ini`
- Create: `apps/agents/py.typed`
- Modify: `apps/agents/package.json`
- Modify: `apps/agents/Makefile`
- Modify: `apps/agents/Dockerfile`
- Modify: `apps/agents/README.md`

- [ ] **Step 1: Write failing script smoke test**

```python
# apps/agents/tests/test_scripts.py
from __future__ import annotations

import json
from pathlib import Path


def test_package_json_dev_uses_cmd_rest() -> None:
    package_json = json.loads(Path("package.json").read_text())
    assert "agents.cmd.rest:app" in package_json["scripts"]["dev"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && uv run pytest tests/test_scripts.py -q`
Expected: FAIL because `package.json` still points to `agents.main:create_app`.

- [ ] **Step 3: Implement infra files and script updates**

```json
// apps/agents/package.json
{
  "name": "agents",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "uv run uvicorn agents.cmd.rest:app --host 0.0.0.0 --port 8080 --reload",
    "build": "uv sync --frozen",
    "check-types": "uv run mypy agents tests",
    "lint": "uv run ruff check agents tests",
    "format": "uv run ruff format agents tests",
    "test": "uv run pytest -m 'not integration'",
    "test:integration": "uv run pytest -m integration"
  }
}
```

```make
# apps/agents/Makefile
.PHONY: install lock sync dev test test-integration test-all lint format check-types revision migrate rollback clean

install: lock sync

lock:
	uv lock

sync:
	uv sync --frozen

dev:
	uv run uvicorn agents.cmd.rest:app --host 0.0.0.0 --port 8080 --reload

test:
	uv run pytest -m 'not integration'

test-integration:
	uv run pytest -m integration

test-all:
	uv run pytest

lint:
	uv run ruff check agents tests

format:
	uv run ruff format agents tests

check-types:
	uv run mypy agents tests

revision:
	uv run alembic revision --autogenerate -m "$(NAME)"

migrate:
	uv run alembic upgrade head

rollback:
	uv run alembic downgrade $(NUM)

clean:
	rm -rf .venv .pytest_cache .ruff_cache .mypy_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
```

```dockerfile
# apps/agents/Dockerfile
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1

RUN pip install --no-cache-dir uv==0.5.*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY agents ./agents

EXPOSE 8080
CMD ["uv", "run", "uvicorn", "agents.cmd.rest:app", "--host", "0.0.0.0", "--port", "8080"]
```

```ini
# apps/agents/pytest.ini
[pytest]
asyncio_mode = auto
addopts = -ra --strict-markers
markers =
    integration: integration tests that require live services
pythonpath = .
testpaths = tests
```

```gitignore
# apps/agents/.gitignore
.venv/
.pytest_cache/
.ruff_cache/
.mypy_cache/
__pycache__/
*.pyc
```

```text
# apps/agents/.dockerignore
**/.pytest_cache
**/.ruff_cache
**/.mypy_cache
**/__pycache__
**/.venv
**/.git
**/node_modules
README.md
```

```yaml
# apps/agents/.pre-commit-config.yaml
default_language_version:
  python: python3.12

repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: check-yaml
      - id: check-toml
      - id: check-merge-conflict
      - id: trailing-whitespace
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.12.4
    hooks:
      - id: ruff-check
        args: [--fix, --exit-non-zero-on-fix]
      - id: ruff-format
```

```text
# apps/agents/py.typed

```

```md
# apps/agents/README.md (section excerpt)
## Entrypoints

- REST: `uv run uvicorn agents.cmd.rest:app --host 0.0.0.0 --port 8080 --reload`
- CLI: `uv run python cli --help`

## Tests

- Unit: `uv run pytest -m 'not integration'`
- Integration (Ollama): `uv run pytest -m integration`
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agents && uv run pytest tests/test_scripts.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/test_scripts.py \
  apps/agents/.dockerignore \
  apps/agents/.gitignore \
  apps/agents/.pre-commit-config.yaml \
  apps/agents/pytest.ini \
  apps/agents/py.typed \
  apps/agents/package.json \
  apps/agents/Makefile \
  apps/agents/Dockerfile \
  apps/agents/README.md
git commit -m "chore(agents): align infra files and scripts with new entrypoints"
```

### Task 9: Add Alembic Scaffold with Checkpoint Table Exclusion

**Files:**
- Create: `apps/agents/tests/test_alembic_env.py`
- Create: `apps/agents/agents_migrations_env.py`
- Create: `apps/agents/alembic.ini`
- Create: `apps/agents/migrations/env.py`
- Create: `apps/agents/migrations/script.py.mako`
- Create: `apps/agents/migrations/README`
- Create: `apps/agents/migrations/versions/.gitkeep`

- [ ] **Step 1: Write failing Alembic env test**

```python
# apps/agents/tests/test_alembic_env.py
from __future__ import annotations

from agents_migrations_env import include_object


def test_include_object_excludes_checkpoints() -> None:
    assert include_object(None, "checkpoints", "table", False, None) is False
    assert include_object(None, "notes", "table", False, None) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && uv run pytest tests/test_alembic_env.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'agents_migrations_env'`.

- [ ] **Step 3: Implement Alembic scaffold and testable include helper**

```python
# apps/agents/agents_migrations_env.py
from __future__ import annotations


def include_object(_object: object, name: str | None, type_: str, _reflected: bool, _compare_to: object) -> bool:
    if type_ != "table":
        return True
    if not name:
        return True
    return not name.startswith("checkpoint") and not name.startswith("checkpoints")
```

```ini
# apps/agents/alembic.ini
[alembic]
script_location = migrations
prepend_sys_path = .
sqlalchemy.url = %(AGENTS_DATABASE_URL)s

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

```python
# apps/agents/migrations/env.py
from __future__ import annotations

from alembic import context
from sqlalchemy import engine_from_config, pool

from agents_migrations_env import include_object

config = context.config
target_metadata = None


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

```mako
## apps/agents/migrations/script.py.mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
```

```text
# apps/agents/migrations/README
Use `make revision NAME=<message>` and `make migrate`.
Do not add LangGraph checkpoint tables to Alembic migrations.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/agents && uv run pytest tests/test_alembic_env.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/test_alembic_env.py \
  apps/agents/agents_migrations_env.py \
  apps/agents/alembic.ini \
  apps/agents/migrations/env.py \
  apps/agents/migrations/script.py.mako \
  apps/agents/migrations/README \
  apps/agents/migrations/versions/.gitkeep
git commit -m "feat(agents): add alembic scaffold with checkpoint exclusions"
```

### Task 10: Migrate Integration Test, Remove Legacy Modules, Run Full Verification

**Files:**
- Create: `apps/agents/tests/test_legacy_removed.py`
- Modify: `apps/agents/tests/conftest.py`
- Modify: `apps/agents/tests/test_generate_ollama.py`
- Delete: `apps/agents/agents/main.py`
- Delete: `apps/agents/agents/exceptions.py`
- Delete: `apps/agents/agents/di/__init__.py`
- Delete: `apps/agents/agents/di/providers.py`
- Delete: `apps/agents/agents/entrypoints/__init__.py`
- Delete: `apps/agents/agents/entrypoints/rest/__init__.py`
- Delete: `apps/agents/agents/entrypoints/rest/auth.py`
- Delete: `apps/agents/agents/entrypoints/rest/generate.py`
- Delete: `apps/agents/agents/entrypoints/rest/health.py`
- Delete: `apps/agents/agents/entrypoints/rest/router.py`
- Delete: `apps/agents/agents/services/__init__.py`
- Delete: `apps/agents/agents/services/graph.py`
- Delete: `apps/agents/agents/services/mcp_tools.py`
- Delete: `apps/agents/agents/services/prompt_renderer.py`
- Delete: `apps/agents/agents/services/providers.py`
- Delete: `apps/agents/agents/schemas/__init__.py`
- Delete: `apps/agents/agents/schemas/generate.py`
- Delete: `apps/agents/agents/schemas/streaming.py`

- [ ] **Step 1: Write failing legacy-removal guard test**

```python
# apps/agents/tests/test_legacy_removed.py
from __future__ import annotations

import importlib.util


def test_legacy_entrypoints_package_removed() -> None:
    assert importlib.util.find_spec("agents.entrypoints") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && uv run pytest tests/test_legacy_removed.py -q`
Expected: FAIL because legacy package still exists.

- [ ] **Step 3: Update integration test + remove legacy modules**

```python
# apps/agents/tests/test_generate_ollama.py (import and app creation excerpt)
from __future__ import annotations

import json
import uuid

import httpx
import pytest

from agents.cmd.rest import app

pytestmark = pytest.mark.integration


def _payload() -> dict[str, object]:
    return {
        "threadId": str(uuid.uuid4()),
        "model": {
            "provider": "ollama",
            "name": "gemma4",
            "connection": {"baseUrl": "http://localhost:11434"},
            "settings": {"temperature": 0.0, "maxOutputTokens": 64},
        },
        "conversation": {"messages": []},
        "userRequest": {"text": "Ответь одним словом: привет"},
    }


@pytest.mark.asyncio
async def test_generate_streams_tokens_from_ollama() -> None:
    try:
        async with httpx.AsyncClient() as probe:
            response = await probe.get("http://localhost:11434/api/tags", timeout=2.0)
            response.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Ollama not reachable: {exc!r}")

    tokens: list[str] = []
    done = False
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream(
            "POST",
            "/api/v1/generate",
            json=_payload(),
            headers={"Authorization": "Bearer test-token-123"},
        ) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                event = json.loads(line.removeprefix("data:").strip())
                if event.get("type") == "token":
                    tokens.append(event["text"])
                if event.get("type") == "done":
                    done = True
                    break

    assert tokens
    assert done
```

```python
# apps/agents/tests/conftest.py (env excerpt)
from __future__ import annotations

from collections.abc import Iterator

import pytest


@pytest.fixture(autouse=True)
def fake_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("AGENTS_DATABASE_URL", "postgresql://user:password@localhost:5432/agents")
    monkeypatch.setenv("AGENTS_SERVICE_TOKEN", "test-token-123")
    monkeypatch.setenv("AGENTS_LOG_LEVEL", "INFO")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("CORS_ORIGINS", "[]")
    monkeypatch.setenv("SENTRY_DSN", "")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    monkeypatch.setenv("OLLAMA_DEFAULT_MODEL", "gemma4")
    yield
```

Also delete all legacy files listed in this task.

- [ ] **Step 4: Run full verification**

Run: `cd apps/agents && uv run pytest -m 'not integration'`
Expected: PASS.

Run: `cd apps/agents && uv run pytest -m integration -q`
Expected: PASS when Ollama/Postgres are up; SKIP when Ollama unavailable.

Run: `cd apps/agents && uv run mypy agents tests && uv run ruff check agents tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/tests/conftest.py \
  apps/agents/tests/test_generate_ollama.py \
  apps/agents/tests/test_legacy_removed.py
git rm apps/agents/agents/main.py \
  apps/agents/agents/exceptions.py \
  apps/agents/agents/di/__init__.py \
  apps/agents/agents/di/providers.py \
  apps/agents/agents/entrypoints/__init__.py \
  apps/agents/agents/entrypoints/rest/__init__.py \
  apps/agents/agents/entrypoints/rest/auth.py \
  apps/agents/agents/entrypoints/rest/generate.py \
  apps/agents/agents/entrypoints/rest/health.py \
  apps/agents/agents/entrypoints/rest/router.py \
  apps/agents/agents/services/__init__.py \
  apps/agents/agents/services/graph.py \
  apps/agents/agents/services/mcp_tools.py \
  apps/agents/agents/services/prompt_renderer.py \
  apps/agents/agents/services/providers.py \
  apps/agents/agents/schemas/__init__.py \
  apps/agents/agents/schemas/generate.py \
  apps/agents/agents/schemas/streaming.py
git commit -m "refactor(agents): cut over to chat module architecture and remove legacy stack"
```

## Final Verification Checklist

- [ ] `cd apps/agents && uv sync --frozen`
- [ ] `cd apps/agents && uv run pytest -m 'not integration'`
- [ ] `cd apps/agents && uv run pytest -m integration`
- [ ] `cd apps/agents && uv run mypy agents tests`
- [ ] `cd apps/agents && uv run ruff check agents tests`
- [ ] `cd apps/agents && uv run uvicorn agents.cmd.rest:app --host 0.0.0.0 --port 8080`
