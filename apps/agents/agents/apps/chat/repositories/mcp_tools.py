import asyncio
import json
import logging
from typing import Any, ClassVar

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

from ..errors import McpRequestError
from ..schemas import McpServerSchema, McpServerToolsSchema, McpToolSchema

log = logging.getLogger(__name__)


class McpToolsRepository:
    """Fetch and wrap tools from MCP servers."""

    JSON_TYPE_MAP: ClassVar[dict[str, type[Any]]] = {
        'string': str,
        'integer': int,
        'number': float,
        'boolean': bool,
        'array': list,
        'object': dict,
    }

    def resolve_field_type(self, spec: dict[str, Any]) -> tuple[Any, bool]:
        raw_type = spec.get('type')

        if isinstance(raw_type, str):
            return self.JSON_TYPE_MAP.get(raw_type, Any), raw_type == 'null'

        if isinstance(raw_type, list):
            allow_null = 'null' in raw_type
            first_known = next(
                (
                    self.JSON_TYPE_MAP[item]
                    for item in raw_type
                    if isinstance(item, str) and item != 'null' and item in self.JSON_TYPE_MAP
                ),
                Any,
            )
            return first_known, allow_null

        variants = spec.get('anyOf') or spec.get('oneOf')
        if isinstance(variants, list):
            allow_null = False
            for variant in variants:
                if not isinstance(variant, dict):
                    continue
                variant_type, variant_allows_null = self.resolve_field_type(variant)
                allow_null = allow_null or variant_allows_null
                if variant_type is not type(None):
                    return variant_type, allow_null
            return Any, allow_null

        return Any, False

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

    async def fetch_mcp_tools(self, servers: list[McpServerSchema]) -> tuple[list[StructuredTool], list[McpServerToolsSchema]]:
        tools: list[StructuredTool] = []
        mcp_tools: list[McpServerToolsSchema] = []
        mcp_server_responses = await asyncio.gather(
            *[
                self.post_mcp(server, {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {}})
                for server in servers
            ],
            return_exceptions=True,
        )
        for mcp_server, response in zip(servers, mcp_server_responses, strict=True):
            if isinstance(response, Exception):
                log.warning('MCP server %s unreachable: %s', mcp_server.name, response)
                continue

            mcp_server_tool = McpServerToolsSchema(name=mcp_server.name, description=mcp_server.description)

            for entry in response.get('tools', []) if isinstance(response, dict) else []:
                tools.append(self.wrap_tool(mcp_server, entry))

                mcp_server_tool.tools.append(McpToolSchema(
                    name=entry.get('name', 'unnamed'),
                    description=entry.get('description', ''),
                ))

            mcp_tools.append(mcp_server_tool)

        return tools, mcp_tools

    def wrap_tool(self, server: McpServerSchema, entry: dict[str, Any]) -> StructuredTool:
        name = str(entry.get('name') or 'unnamed')
        description = str(entry.get('description') or f'MCP tool {name} on {server.name}')
        args_schema = self.argument_schema(entry)

        async def call(**kwargs: Any) -> str:
            try:
                result = await self.post_mcp(
                    server,
                    {
                        'jsonrpc': '2.0',
                        'id': 2,
                        'method': 'tools/call',
                        'params': {'name': name, 'arguments': kwargs},
                    },
                )
            except Exception as exc:
                return f"tool '{name}' error: {exc}"
            if isinstance(result, dict) and 'content' in result:
                chunks = result.get('content') or []
                text = '\n'.join(
                    str(c.get('text', '')) for c in chunks if isinstance(c, dict) and c.get('type') == 'text'
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
    ) -> tuple[Any, Field]:  # type: ignore
        py_type, allow_null = self.resolve_field_type(spec)
        description = spec.get('description')

        if allow_null and py_type is not Any:
            py_type = py_type | None

        if prop_name in required_fields:
            return py_type, Field(..., description=description)

        if py_type is Any:
            return py_type, Field(default=None, description=description)

        return py_type | None, Field(default=None, description=description)

    def argument_schema(self, tool: dict[str, Any]) -> type[BaseModel]:
        schema_name = f'{tool.get("name") or "McpTool"}Args'
        input_schema = tool.get('inputSchema') or {}
        properties = input_schema.get('properties') or {}
        required_fields = set(input_schema.get('required') or [])

        field_definitions: dict[str, Any] = {
            prop_name: self.build_field_definition(prop_name, spec, required_fields)
            for prop_name, spec in properties.items()
        }

        return create_model(schema_name, **field_definitions)
