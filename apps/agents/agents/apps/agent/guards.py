from typing import Annotated

from dishka import AsyncContainer
from fastapi import Header, HTTPException, Request, status

from agents.apps.agent.errors import JwtVerificationError
from agents.apps.agent.schemas import AgentContext
from agents.apps.agent.services.jwt_verifier import JwtVerifierService
from agents.apps.agent.utils import extract_bearer_token


async def _verifier(request: Request) -> JwtVerifierService:
    container: AsyncContainer = request.state.dishka_container
    return await container.get(JwtVerifierService)


def _require_token(authorization: str) -> str:
    token = extract_bearer_token(authorization)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='missing bearer token',
        )
    return token


async def verify_agents_jwt(
    authorization: Annotated[str, Header()],
    request: Request,
) -> AgentContext:
    """FastAPI dependency: verifies the agents JWT and returns the context."""
    token = _require_token(authorization)
    verifier = await _verifier(request)
    try:
        return verifier.verify_chat(token)
    except JwtVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc


async def verify_agents_service_token(
    authorization: Annotated[str, Header()],
    request: Request,
) -> None:
    """FastAPI dependency for internal service calls: signature+audience only."""
    token = _require_token(authorization)
    verifier = await _verifier(request)
    try:
        verifier.verify_service(token)
    except JwtVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
