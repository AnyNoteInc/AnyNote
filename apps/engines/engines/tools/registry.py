"""MCP tool registry — wires Page repo + Qdrant search to FastMCP."""

from __future__ import annotations

from typing import Any

from fastmcp import FastMCP

from engines.services.embeddings import OllamaEmbeddings
from engines.services.page_repo import PageRepo
from engines.services.search import SearchService


def build_mcp(
    *,
    page_repo: PageRepo,
    search: SearchService,
    embeddings: OllamaEmbeddings,
    name: str = "anynote-engines",
) -> FastMCP[Any]:
    mcp: FastMCP[Any] = FastMCP(name=name)

    @mcp.tool(description="Семантический поиск страниц workspace по запросу.")
    async def search_workspace_pages(
        query: str, workspace_id: str, top_k: int = 5
    ) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        vector = await embeddings.embed(query)
        hits = await search.search(query_vector=vector, workspace_id=workspace_id, top_k=top_k)
        return [
            {
                "pageId": h.page_id,
                "title": h.title,
                "chunkText": h.chunk_text,
                "score": h.score,
            }
            for h in hits
        ]

    @mcp.tool(description="Получить полный текст страницы по её ID.")
    async def get_page(page_id: str, workspace_id: str | None = None) -> dict[str, Any] | None:
        page = await page_repo.get_page(page_id, workspace_id)
        if page is None:
            return None
        return {
            "id": page.id,
            "workspaceId": page.workspace_id,
            "title": page.title,
            "ownership": page.ownership,
            "type": page.type,
            "text": page.content_text,
        }

    @mcp.tool(description="Список страниц workspace, последние обновлённые сверху.")
    async def list_workspace_pages(workspace_id: str, limit: int = 20) -> list[dict[str, Any]]:
        pages = await page_repo.list_pages(workspace_id=workspace_id, limit=limit)
        return [
            {
                "id": p.id,
                "title": p.title,
                "ownership": p.ownership,
                "type": p.type,
            }
            for p in pages
        ]

    return mcp
