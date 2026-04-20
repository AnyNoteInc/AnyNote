"""Page lookup helpers backed by asyncpg."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import asyncpg  # type: ignore[import-untyped]


@dataclass(slots=True)
class PageRow:
    id: str
    workspace_id: str
    title: str | None
    content_text: str
    ownership: str
    type: str


def _walk_tiptap(node: Any, parts: list[str]) -> None:
    if not isinstance(node, dict):
        return
    if node.get("type") == "text" and isinstance(node.get("text"), str):
        parts.append(node["text"])
        return
    children = node.get("content")
    if isinstance(children, list):
        for child in children:
            _walk_tiptap(child, parts)
    if node.get("type") in {"paragraph", "heading", "blockquote", "listItem", "codeBlock"}:
        parts.append("\n\n")


def tiptap_to_text(content: Any) -> str:
    if not content:
        return ""
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError:
            return ""
    parts: list[str] = []
    _walk_tiptap(content, parts)
    text = "".join(parts)
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()


class PageRepo:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    async def get_page(self, page_id: str, workspace_id: str | None = None) -> PageRow | None:
        async with self.pool.acquire() as conn:
            if workspace_id:
                row = await conn.fetchrow(
                    """
                    SELECT id, workspace_id, title, content, ownership, type
                    FROM pages
                    WHERE id = $1::uuid AND workspace_id = $2::uuid AND deleted_at IS NULL
                    """,
                    page_id,
                    workspace_id,
                )
            else:
                row = await conn.fetchrow(
                    """
                    SELECT id, workspace_id, title, content, ownership, type
                    FROM pages
                    WHERE id = $1::uuid AND deleted_at IS NULL
                    """,
                    page_id,
                )
        if row is None:
            return None
        return PageRow(
            id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            title=row["title"],
            content_text=tiptap_to_text(row["content"]),
            ownership=str(row["ownership"]),
            type=str(row["type"]),
        )

    async def list_pages(self, workspace_id: str, limit: int = 20) -> list[PageRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, workspace_id, title, content, ownership, type
                FROM pages
                WHERE workspace_id = $1::uuid AND deleted_at IS NULL AND archived = false
                ORDER BY updated_at DESC
                LIMIT $2
                """,
                workspace_id,
                max(1, min(limit, 100)),
            )
        return [
            PageRow(
                id=str(r["id"]),
                workspace_id=str(r["workspace_id"]),
                title=r["title"],
                content_text=tiptap_to_text(r["content"]),
                ownership=str(r["ownership"]),
                type=str(r["type"]),
            )
            for r in rows
        ]
