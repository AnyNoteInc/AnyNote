
import asyncio
import json
import logging
from typing import Any

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

from ..errors import McpRequestError
from ..schemas import McpServerSchema, UserContextSchema

log = logging.getLogger(__name__)


class McpToolsRepository:
    """Fetch and wrap tools from MCP servers."""

    JSON_TYPE_MAP: dict[str, type[Any]] = {
        'string': str,
        'integer': int,
        'number': float,
        'boolean': bool,
        'array': list,
        'object': dict,
    }

    def make_client(self, server: McpServerSchema) -> httpx.AsyncClient:
        transport = httpx.AsyncHTTPTransport(retries=server.retries, verify=server.verify)
        return httpx.AsyncClient(transport=transport)

    async def post_mcp(self, server: McpServerSchema, payload: dict[str, Any]) -> Any:
        async with self.make_client(server) as client:
            resp = await client.post(server.url, json=payload, headers=server.headers, timeout=30.0)
            resp.raise_for_status()
            body = resp.json()
            if isinstance(body, dict) and 'error' in body:
                raise McpRequestError(server, body['error'])
            return body.get('result') if isinstance(body, dict) else body

    async def fetch_mcp_tools(self, servers: list[McpServerSchema]) -> list[StructuredTool]:
        tools: list[StructuredTool] = []
        mcp_server_responses = await asyncio.gather(
            *[self.post_mcp(server, {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}) for server in servers],
            return_exceptions=True,
        )
        for mcp_server, response in zip(servers, mcp_server_responses, strict=True):
            if isinstance(response, Exception):
                log.warning("MCP server %s unreachable: %s", mcp_server.name, response)
                continue
            for entry in response.get("tools", []) if isinstance(response, dict) else []:
                tools.append(self.wrap_tool(mcp_server, entry))
        return tools

    def wrap_tool(self, server: McpServerSchema, entry: dict[str, Any]) -> StructuredTool:
        name = str(entry.get("name") or "unnamed")
        description = str(entry.get("description") or f"MCP tool {name} on {server.name}")
        args_schema = self.argument_schema(entry)

        async def call(**kwargs: Any) -> str:
            try:
                result = await self.post_mcp(
                    server,
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
            coroutine=call,
            name=name,
            description=description,
            args_schema=args_schema,
        )


    def build_field_definition(
        self,
        prop_name: str,
        spec: dict[str, Any],
        required_fields: set[str],
    ) -> tuple[Any, Field]: # type: ignore
        py_type = self.JSON_TYPE_MAP.get(spec.get('type', 'string'), str)
        description = spec.get("description")

        if prop_name in required_fields:
            return py_type, Field(..., description=description)

        return py_type | None, Field(default=None, description=description)


    def argument_schema(self, tool: dict[str, Any]) -> type[BaseModel]:
        schema_name = f"{tool.get('name') or 'McpTool'}Args"
        input_schema = tool.get("inputSchema") or {}
        properties = input_schema.get("properties") or {}
        required_fields = set(input_schema.get("required") or [])

        field_definitions: dict[str, Any] = {
            prop_name: self.build_field_definition(prop_name, spec, required_fields)
            for prop_name, spec in properties.items()
        }

        return create_model(schema_name, **field_definitions)


