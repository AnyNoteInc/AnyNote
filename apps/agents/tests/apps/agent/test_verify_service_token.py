import base64
import os
import time

import jwt
import pytest
from agents.apps.agent.errors import JwtVerificationError
from agents.apps.agent.guards import verify_agents_service_token
from agents.apps.agent.services.jwt_verifier import JwtVerifierService
from agents.apps.agent.utils import extract_bearer_token
from fastapi import HTTPException

# Ensure AGENTS_JWT_SECRET is available even if .env wasn't loaded
os.environ.setdefault('AGENTS_JWT_SECRET', base64.b64encode(b'0' * 32).decode())


def _verifier() -> JwtVerifierService:
    return JwtVerifierService(
        secret_b64=os.environ['AGENTS_JWT_SECRET'],
        audience=os.environ.get('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents'),
    )


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


class _FakeContainer:
    def __init__(self, verifier: JwtVerifierService) -> None:
        self._verifier = verifier

    async def get(self, dependency_type):
        return self._verifier


class _FakeRequest:
    def __init__(self, verifier: JwtVerifierService) -> None:
        self.state = type('S', (), {'dishka_container': _FakeContainer(verifier)})()


# --- service: verification matrix ---

def test_service_accepts_valid_token() -> None:
    _verifier().verify_service(_make_token())  # no raise


def test_service_rejects_bad_signature() -> None:
    with pytest.raises(JwtVerificationError):
        _verifier().verify_service('not.a.jwt')


def test_service_rejects_wrong_audience() -> None:
    with pytest.raises(JwtVerificationError):
        _verifier().verify_service(_make_token(aud='not-agents'))


def test_service_rejects_expired_token() -> None:
    with pytest.raises(JwtVerificationError):
        _verifier().verify_service(_make_token(exp=int(time.time()) - 10))


# --- util: bearer parsing ---

def test_extract_bearer_token() -> None:
    assert extract_bearer_token(f'Bearer {_make_token()}') is not None
    assert extract_bearer_token('') is None
    assert extract_bearer_token('Basic abc') is None


# --- guard: HTTP 401 contract preserved ---

async def test_guard_rejects_missing_token() -> None:
    with pytest.raises(HTTPException) as ei:
        await verify_agents_service_token('', _FakeRequest(_verifier()))
    assert ei.value.status_code == 401


async def test_guard_rejects_bad_token() -> None:
    with pytest.raises(HTTPException) as ei:
        await verify_agents_service_token('Bearer not.a.jwt', _FakeRequest(_verifier()))
    assert ei.value.status_code == 401


async def test_guard_accepts_valid_token() -> None:
    # valid token → no HTTPException raised (guard returns None)
    await verify_agents_service_token(f'Bearer {_make_token()}', _FakeRequest(_verifier()))
