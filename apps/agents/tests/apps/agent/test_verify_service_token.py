import base64
import os
import time

import jwt
import pytest
from agents.apps.agent.depends import verify_agents_service_token
from fastapi import HTTPException

# Ensure AGENTS_JWT_SECRET is available even if .env wasn't loaded
os.environ.setdefault('AGENTS_JWT_SECRET', base64.b64encode(b'0' * 32).decode())


def _make_token(**overrides) -> str:
    secret = base64.b64decode(os.environ['AGENTS_JWT_SECRET'])
    claims = {
        'sub': 'u1',
        'wsid': 'w1',
        'aud': os.environ.get('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents'),
        'exp': int(time.time()) + 60,
    }
    claims.update(overrides)
    return jwt.encode(claims, secret, algorithm='HS256')


def test_accepts_valid_service_token() -> None:
    # Should not raise; return value is None (-> None annotated)
    verify_agents_service_token(f'Bearer {_make_token()}')


def test_rejects_missing_token() -> None:
    with pytest.raises(HTTPException) as ei:
        verify_agents_service_token('')
    assert ei.value.status_code == 401


def test_rejects_bad_signature() -> None:
    with pytest.raises(HTTPException) as ei:
        verify_agents_service_token('Bearer not.a.jwt')
    assert ei.value.status_code == 401
