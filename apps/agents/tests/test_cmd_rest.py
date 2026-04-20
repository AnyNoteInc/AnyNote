from __future__ import annotations

from importlib import import_module

from fastapi import FastAPI


def test_cmd_rest_exports_fastapi_app() -> None:
    module = import_module("agents.cmd.rest")
    assert isinstance(module.app, FastAPI)
    assert any(getattr(route, "path", None) == "/health" for route in module.app.routes)
