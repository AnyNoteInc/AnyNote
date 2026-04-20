"""Lightweight MCP HTTP tool loader."""

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
        py_type: type[Any] = _json_type_to_python(spec.get("type"))
        description = spec.get("description") or None
        if prop_name in required:
            fields[prop_name] = (py_type, Field(..., description=description))
        else:
            fields[prop_name] = (py_type | None, Field(None, description=description))
    if not fields:
        return create_model(schema_name)
    return create_model(schema_name, **fields)


async def _post_mcp(client: httpx.AsyncClient, server: McpServer, payload: dict[str, Any]) -> Any:
    if not server.url:
        raise RuntimeError(f"MCP server {server.name} has no url")
    url: str = server.url
    headers = {"content-type": "application/json", "accept": "application/json"}
    if server.auth_header:
        headers["authorization"] = server.auth_header
    resp = await client.post(url, json=payload, headers=headers, timeout=30.0)
    resp.raise_for_status()
    body = resp.json()
    if isinstance(body, dict) and "error" in body and body["error"]:
        raise RuntimeError(f"MCP error: {body['error']}")
    return body.get("result") if isinstance(body, dict) else body


async def fetch_mcp_tools(servers: list[McpServer]) -> list[StructuredTool]:
    if not servers:
        return []
    tools: list[StructuredTool] = []
    async with httpx.AsyncClient() as client:
        for server in servers:
            try:
                listed = await _post_mcp(
                    client,
                    server,
                    {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                )
            except Exception as exc:
                log.warning("MCP server %s unreachable: %s", server.name, exc)
                continue
            for entry in listed.get("tools", []) if isinstance(listed, dict) else []:
                tools.append(_wrap_tool(server, entry))
    return tools


def _wrap_tool(server: McpServer, entry: dict[str, Any]) -> StructuredTool:
    name = str(entry.get("name") or "unnamed")
    description = str(entry.get("description") or f"MCP tool {name} on {server.name}")
    args_schema = _argument_schema(entry)
    server_snapshot = server

    async def call(**kwargs: Any) -> str:
        async with httpx.AsyncClient() as client:
            try:
                result = await _post_mcp(
                    client,
                    server_snapshot,
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/call",
                        "params": {"name": name, "arguments": kwargs},
                    },
                )
            except Exception as exc:
                return f"tool '{name}' error: {exc}"
        if isinstance(result, dict) and "content" in result:
            chunks = result.get("content") or []
            text = "\n".join(
                str(c.get("text", ""))
                for c in chunks
                if isinstance(c, dict) and c.get("type") == "text"
            )
            return text or json.dumps(result, ensure_ascii=False)
        return json.dumps(result, ensure_ascii=False)

    return StructuredTool.from_function(
        coroutine=_make_async_runner(call),
        name=name,
        description=description,
        args_schema=args_schema,
    )


def _make_async_runner(coroutine: Callable[..., Any]) -> Callable[..., Any]:
    return coroutine
