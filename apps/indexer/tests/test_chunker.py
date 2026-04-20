"""Tests for the Tiptap extractor and chunker."""

from __future__ import annotations

from indexer.services.chunker import Chunker, tiptap_to_text


def test_tiptap_empty() -> None:
    assert tiptap_to_text(None) == ""
    assert tiptap_to_text({}) == ""


def test_tiptap_simple_paragraph() -> None:
    doc = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "hello world"}]},
        ],
    }
    assert tiptap_to_text(doc) == "hello world"


def test_tiptap_multi_paragraph() -> None:
    doc = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "first"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "second"}]},
        ],
    }
    assert tiptap_to_text(doc) == "first\n\nsecond"


def test_tiptap_heading_and_list() -> None:
    doc = {
        "type": "doc",
        "content": [
            {"type": "heading", "content": [{"type": "text", "text": "Title"}]},
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "a"}],
                            }
                        ],
                    },
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "b"}],
                            }
                        ],
                    },
                ],
            },
        ],
    }
    text = tiptap_to_text(doc)
    assert "Title" in text and "a" in text and "b" in text


def test_chunker_empty() -> None:
    assert Chunker().chunk("") == []
    assert Chunker().chunk("   ") == []


def test_chunker_single_short_chunk() -> None:
    assert Chunker(max_chars=100).chunk("hello world") == ["hello world"]


def test_chunker_splits_on_paragraphs() -> None:
    text = "p1\n\np2\n\np3"
    chunks = Chunker(max_chars=4, overlap=0).chunk(text)
    assert chunks == ["p1", "p2", "p3"]


def test_chunker_hard_splits_long_paragraph() -> None:
    text = "a" * 500
    chunker = Chunker(max_chars=200, overlap=50)
    chunks = chunker.chunk(text)
    assert len(chunks) >= 3
    for c in chunks:
        assert len(c) <= 200
