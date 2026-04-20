"""Tiptap JSON → text extraction + chunking."""

from __future__ import annotations

from typing import Any


def tiptap_to_text(content: dict[str, Any] | None) -> str:
    """Walk a Tiptap JSON document and return plain text."""
    if not content:
        return ""
    parts: list[str] = []
    _walk(content, parts)
    text = "".join(parts)
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()


def _walk(node: dict[str, Any], parts: list[str]) -> None:
    node_type = node.get("type")
    if node_type == "text":
        parts.append(str(node.get("text", "")))
        return
    children = node.get("content")
    if isinstance(children, list):
        for child in children:
            if isinstance(child, dict):
                _walk(child, parts)
    if node_type in {"paragraph", "heading", "blockquote", "listItem", "codeBlock"}:
        parts.append("\n\n")
    elif node_type == "hardBreak":
        parts.append("\n")


class Chunker:
    """Splits text into chunks of approximately ``max_chars`` with ``overlap``."""

    def __init__(self, *, max_chars: int = 2000, overlap: int = 200) -> None:
        self.max_chars = max_chars
        self.overlap = overlap

    def chunk(self, text: str) -> list[str]:
        text = text.strip()
        if not text:
            return []
        if len(text) <= self.max_chars:
            return [text]

        paragraphs = [p for p in text.split("\n\n") if p.strip()]
        chunks: list[str] = []
        buffer = ""
        for para in paragraphs:
            if not buffer:
                buffer = para
                continue
            candidate = f"{buffer}\n\n{para}"
            if len(candidate) <= self.max_chars:
                buffer = candidate
            else:
                chunks.append(buffer)
                buffer = para
        if buffer:
            chunks.append(buffer)

        result: list[str] = []
        for chunk in chunks:
            if len(chunk) <= self.max_chars:
                result.append(chunk)
            else:
                result.extend(self._hard_split(chunk))
        return result

    def _hard_split(self, text: str) -> list[str]:
        chunks: list[str] = []
        step = max(1, self.max_chars - self.overlap)
        start = 0
        while start < len(text):
            end = start + self.max_chars
            chunks.append(text[start:end])
            if end >= len(text):
                break
            start += step
        return chunks
