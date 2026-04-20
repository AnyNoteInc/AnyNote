from __future__ import annotations

from agents.apps.chat.router import router


def test_router_registers_generate_endpoint() -> None:
    assert any(route.path == "/api/v1/generate" and "POST" in route.methods for route in router.routes)
