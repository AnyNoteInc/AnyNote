from __future__ import annotations

import base64
import os
from typing import Annotated

import jwt
from fastapi import Header, HTTPException, status

from .errors import JwtVerificationError
from .schemas import AgentContext


def _audience() -> str:
    return os.environ.get('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents')


def _secret() -> bytes:
    raw = os.environ.get('AGENTS_JWT_SECRET')
    if not raw:
        raise JwtVerificationError('AGENTS_JWT_SECRET is not set')
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise JwtVerificationError('AGENTS_JWT_SECRET must decode to 32 bytes')
    return key


def _decode(token: str) -> dict[str, object]:
    try:
        return jwt.decode(
            token,
            _secret(),
            algorithms=['HS256'],
            audience=_audience(),
        )
    except jwt.PyJWTError as exc:
        raise JwtVerificationError(str(exc)) from exc


def claims_to_context(claims: dict[str, object]) -> AgentContext:
    raw_scopes = claims.get('scopes', [])
    scopes: frozenset[str] = frozenset(s for s in (raw_scopes if isinstance(raw_scopes, list) else []) if isinstance(s, str))
    return AgentContext(
        user_id=claims['sub'],
        workspace_id=claims['wsid'],
        chat_id=claims['cid'],
        scopes=scopes,
    )


async def verify_agents_jwt(
    authorization: Annotated[str, Header()],
) -> AgentContext:
    """FastAPI dependency: verifies the agents JWT and returns the context."""
    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='missing bearer token',
        )
    try:
        return claims_to_context(_decode(token))
    except JwtVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc


# Test seam — bypasses Header dependency for direct test calls.
async def verify_agents_jwt_for_test(token: str) -> AgentContext:
    return claims_to_context(_decode(token))
