from __future__ import annotations

from importlib import import_module


def test_cmd_rest_exports_fastapi_app() -> None:
    module = import_module("agents.cmd.rest")
    assert hasattr(module, "app")
