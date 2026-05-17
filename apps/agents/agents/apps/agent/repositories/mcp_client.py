from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

from agents.apps.chat.schemas import McpServerSchema

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class McpToolDescriptor:
    name: str
    description: str
    input_schema: dict[str, Any]


# ── SSE session factory (module-level so tests can monkeypatch it) ─────────────

@asynccontextmanager
async def _open_sse_session(url: str, headers: dict[str, str]) -> AsyncIterator[Any]:
    from mcp import ClientSession
    from mcp.client.sse import sse_client
    async with sse_client(url, headers=headers) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


# ── JSON schema → Python type map ─────────────────────────────────────────────

_JSON_TYPE: dict[str, type] = {
    'string': str,
    'integer': int,
    'number': float,
    'boolean': bool,
    'array': list,
    'object': dict,
}


def _arg_model(name: str, schema: dict[str, Any]) -> type[BaseModel]:
    props = (schema or {}).get('properties') or {}
    required = set((schema or {}).get('required') or [])
    fields: dict[str, Any] = {}
    for pname, pspec in props.items():
        ptype: Any = _JSON_TYPE.get(pspec.get('type', ''), Any)
        desc = pspec.get('description')
        if pname in required:
            fields[pname] = (ptype, Field(..., description=desc))
        else:
            fields[pname] = (ptype | None, Field(default=None, description=desc))
    return create_model(f'{name}Args', **fields)


# ── McpClient ─────────────────────────────────────────────────────────────────

@dataclass
class McpClient:
    timeout_seconds: float = 30.0

    async def list_tools(self, server: McpServerSchema) -> list[McpToolDescriptor]:
        if _transport(server) == 'SSE':
            return await self._sse_list_tools(server)
        return self._filter(server, await self._http_list_tools(server))

    async def call_tool(self, server: McpServerSchema, name: str, args: dict[str, Any]) -> str:
        if _transport(server) == 'SSE':
            return await self._sse_call_tool(server, name, args)
        return await self._http_call_tool(server, name, args)

    # ── HTTP JSON-RPC ──────────────────────────────────────────────────────────

    async def _http_list_tools(self, server: McpServerSchema) -> list[McpToolDescriptor]:
        result = await self._post(server, {
            'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {},
        })
        items = (result or {}).get('tools', []) if isinstance(result, dict) else []
        return [
            McpToolDescriptor(
                name=str(t.get('name', 'unnamed')),
                description=str(t.get('description', '')),
                input_schema=t.get('inputSchema') or {},
            )
            for t in items
        ]

    async def _http_call_tool(self, server: McpServerSchema, name: str, args: dict[str, Any]) -> str:
        result = await self._post(server, {
            'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
            'params': {'name': name, 'arguments': args},
        })
        if isinstance(result, dict) and 'content' in result:
            chunks = result.get('content') or []
            text = '\n'.join(
                str(c.get('text', ''))
                for c in chunks
                if isinstance(c, dict) and c.get('type') == 'text'
            )
            return text or json.dumps(result, ensure_ascii=False)
        return json.dumps(result, ensure_ascii=False)

    async def _post(self, server: McpServerSchema, payload: dict[str, Any]) -> Any:
        async with httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(
                retries=getattr(server, 'retries', 1),
                verify=getattr(server, 'verify', True),
            ),
            timeout=self.timeout_seconds,
        ) as client:
            resp = await client.post(server.url, json=payload, headers=server.headers)
            resp.raise_for_status()
            body = resp.json()
            if isinstance(body, dict) and 'error' in body:
                raise RuntimeError(f'MCP {server.name} error: {body["error"]}')
            return body.get('result') if isinstance(body, dict) else body

    # ── SSE ────────────────────────────────────────────────────────────────────

    async def _sse_list_tools(self, server: McpServerSchema) -> list[McpToolDescriptor]:
        async with _open_sse_session(server.url, server.headers) as session:
            listed = await session.list_tools()
            tools = [
                McpToolDescriptor(
                    name=str(t.name),
                    description=str(getattr(t, 'description', '') or ''),
                    input_schema=getattr(t, 'inputSchema', None) or {},
                )
                for t in listed.tools
            ]
            return self._filter(server, tools)

    async def _sse_call_tool(self, server: McpServerSchema, name: str, args: dict[str, Any]) -> str:
        async with _open_sse_session(server.url, server.headers) as session:
            result = await session.call_tool(name, args)
            chunks = getattr(result, 'content', None) or []
            text = '\n'.join(
                getattr(c, 'text', '') for c in chunks if getattr(c, 'type', None) == 'text'
            )
            return text or str(result)

    # ── Parallel discovery ─────────────────────────────────────────────────────

    async def discover_all(
        self,
        servers: list[McpServerSchema],
    ) -> dict[str, list[McpToolDescriptor]]:
        """Discover tools across servers; failures yield warning + omission."""
        coros = [self.list_tools(s) for s in servers]
        results = await asyncio.gather(*coros, return_exceptions=True)
        out: dict[str, list[McpToolDescriptor]] = {}
        for server, res in zip(servers, results, strict=True):
            if isinstance(res, Exception):
                log.warning('MCP server %s discovery failed: %s', server.name, res)
                continue
            out[server.name] = res  # type: ignore[assignment]
        return out

    # ── LangChain tool wrapping ────────────────────────────────────────────────

    def build_langchain_tools(
        self,
        discovered: dict[str, list[McpToolDescriptor]],
        servers: list[McpServerSchema],
    ) -> list[StructuredTool]:
        server_by_name = {s.name: s for s in servers}
        out: list[StructuredTool] = []
        for server_name, tools in discovered.items():
            server = server_by_name[server_name]
            for desc in tools:
                namespaced = f'{server_name}__{desc.name}'
                args_model = _arg_model(namespaced, desc.input_schema)

                async def call(_server: McpServerSchema = server, _name: str = desc.name, **kwargs: Any) -> str:
                    return await self.call_tool(_server, _name, kwargs)

                out.append(StructuredTool.from_function(
                    coroutine=call,
                    name=namespaced,
                    description=desc.description or f'MCP tool {desc.name} on {server_name}',
                    args_schema=args_model,
                ))
        return out

    # ── Helpers ────────────────────────────────────────────────────────────────

    @staticmethod
    def _filter(server: McpServerSchema, tools: list[McpToolDescriptor]) -> list[McpToolDescriptor]:
        allow = set(server.tools or [])
        if not allow:
            return tools
        return [t for t in tools if t.name in allow]


def _transport(server: McpServerSchema) -> str:
    return getattr(server, 'transport', None) or 'HTTP_JSONRPC'
