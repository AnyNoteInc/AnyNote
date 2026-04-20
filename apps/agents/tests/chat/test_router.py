from __future__ import annotations

from fastapi.routing import APIRoute

from agents.apps.chat.router import router


def test_router_registers_generate_endpoint() -> None:
    routes = [route for route in router.routes if isinstance(route, APIRoute)]
    assert any(
        route.path == "/api/v1/generate" and route.methods is not None and "POST" in route.methods
        for route in routes
    )
