import base64
import os
import secrets
import time
from uuid import uuid4

import jwt
import pytest
from agents.apps.agent.depends import verify_agents_jwt_for_test
from agents.apps.agent.errors import JwtVerificationError


@pytest.fixture(autouse=True)
def setup_env(monkeypatch):
    raw_key = secrets.token_bytes(32)
    monkeypatch.setenv('AGENTS_JWT_SECRET', base64.b64encode(raw_key).decode())
    monkeypatch.setenv('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents')


def sign(claims: dict, *, aud: str = 'agents', ttl: int = 300, secret_b64: str | None = None) -> str:
    secret_b64 = secret_b64 or os.environ['AGENTS_JWT_SECRET']
    key = base64.b64decode(secret_b64)
    payload = {
        'iat': int(time.time()),
        'exp': int(time.time()) + ttl,
        'aud': aud,
        **claims,
    }
    return jwt.encode(payload, key, algorithm='HS256')


@pytest.mark.asyncio
async def test_accepts_valid_token() -> None:
    user_id, ws_id, chat_id = str(uuid4()), str(uuid4()), str(uuid4())
    token = sign({
        'sub': user_id,
        'wsid': ws_id,
        'cid': chat_id,
        'scopes': ['pages:read'],
    })
    ctx = await verify_agents_jwt_for_test(token)
    assert str(ctx.user_id) == user_id
    assert str(ctx.workspace_id) == ws_id
    assert str(ctx.chat_id) == chat_id
    assert ctx.scopes == frozenset({'pages:read'})


@pytest.mark.asyncio
async def test_rejects_expired() -> None:
    token = sign(
        {'sub': str(uuid4()), 'wsid': str(uuid4()), 'cid': str(uuid4()), 'scopes': []},
        ttl=-100,
    )
    with pytest.raises(JwtVerificationError):
        await verify_agents_jwt_for_test(token)


@pytest.mark.asyncio
async def test_rejects_wrong_audience() -> None:
    token = sign(
        {'sub': str(uuid4()), 'wsid': str(uuid4()), 'cid': str(uuid4()), 'scopes': []},
        aud='wrong',
    )
    with pytest.raises(JwtVerificationError):
        await verify_agents_jwt_for_test(token)
