"""Pure unit tests for tiptap_to_text helper."""

from __future__ import annotations

from engines.services.page_repo import tiptap_to_text


def test_tiptap_to_text_handles_none() -> None:
    assert tiptap_to_text(None) == ""


def test_tiptap_to_text_handles_simple_doc() -> None:
    doc = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "hello"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "world"}]},
        ],
    }
    assert tiptap_to_text(doc) == "hello\n\nworld"


def test_tiptap_to_text_parses_string_json() -> None:
    raw = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]}'
    assert tiptap_to_text(raw) == "hi"
