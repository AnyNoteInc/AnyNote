import base64

import jwt

from agents.apps.agent.errors import JwtVerificationError
from agents.apps.agent.schemas import AgentContext


class JwtVerifierService:
    """Verifies HS256 agents JWTs. Secret + audience come from settings."""

    def __init__(self, secret_b64: str | None, audience: str) -> None:
        self._secret_b64 = secret_b64
        self._audience = audience

    def verify_chat(self, token: str) -> AgentContext:
        """Full chat-token verification → AgentContext (sub/wsid/cid/scopes)."""
        return self._context_from_claims(self._decode(token))

    def verify_service(self, token: str) -> None:
        """Internal service token: signature + audience only (no cid/scopes)."""
        self._decode(token)

    def _secret(self) -> bytes:
        if not self._secret_b64:
            raise JwtVerificationError('AGENTS_JWT_SECRET is not set')
        key = base64.b64decode(self._secret_b64)
        if len(key) != 32:
            raise JwtVerificationError('AGENTS_JWT_SECRET must decode to 32 bytes')
        return key

    def _decode(self, token: str) -> dict[str, object]:
        try:
            return jwt.decode(
                token,
                self._secret(),
                algorithms=['HS256'],
                audience=self._audience,
            )
        except jwt.PyJWTError as exc:
            raise JwtVerificationError(str(exc)) from exc

    def _context_from_claims(self, claims: dict[str, object]) -> AgentContext:
        raw_scopes = claims.get('scopes', [])
        scopes: frozenset[str] = frozenset(
            s for s in (raw_scopes if isinstance(raw_scopes, list) else []) if isinstance(s, str)
        )
        return AgentContext(
            user_id=claims['sub'],
            workspace_id=claims['wsid'],
            chat_id=claims['cid'],
            scopes=scopes,
        )
