"""Bearer-token FastAPI dependency."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import Header

from agents.exceptions import AuthError
from agents.settings import Settings


@inject
async def require_bearer(
    settings: FromDishka[Settings],
    authorization: str | None = Header(default=None),
) -> None:
    """Raise AuthError if the request's Authorization header does not match
    the configured AGENTS_SERVICE_TOKEN. Settings is pulled from the
    Dishka container (singleton), avoiding a per-request env-var read."""
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthError("Missing or malformed Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    if token != settings.agents_service_token:
        raise AuthError("Invalid bearer token")
