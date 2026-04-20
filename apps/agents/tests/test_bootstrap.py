from __future__ import annotations

from agents.bootstrap import create_app
from agents.router import apply_routes


def test_create_app_registers_routes() -> None:
    app = create_app([apply_routes])
    paths = {route.path for route in app.routes}
    assert "/api/v1/generate" in paths
