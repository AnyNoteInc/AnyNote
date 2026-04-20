"""Settings tests."""

from __future__ import annotations

from engines.settings import Settings


def test_settings_loads_with_required_env() -> None:
    s = Settings()
    assert s.engines_mcp_token == "test-engines-token"
    assert s.engines_qdrant_collection == "anynote-pages"
    assert s.embeddings_dim == 768
