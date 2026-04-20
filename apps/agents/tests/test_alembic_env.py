from __future__ import annotations

from agents_migrations_env import include_object


def test_include_object_excludes_checkpoints() -> None:
    assert include_object(None, "checkpoints", "table", False, None) is False
    assert include_object(None, "notes", "table", False, None) is True
