from typing import TYPE_CHECKING

from fast_clean.exceptions import BusinessLogicException

if TYPE_CHECKING:
    from agents.apps.agent.schemas import McpServerSchema


class AgentError(Exception):
    """Base error for the agent module."""


class JwtVerificationError(AgentError):
    code = 'JWT_INVALID'


class ScopeDeniedError(AgentError):
    code = 'SCOPE_DENIED'


class McpServerUnreachable(AgentError):
    code = 'MCP_UNREACHABLE'


class ConfirmationMismatch(AgentError):
    code = 'CONFIRMATION_MISMATCH'


class PlanLimitReached(AgentError):
    code = 'PLAN_LIMIT'


class InvalidPayloadError(BusinessLogicException):
    def __init__(self, message: str) -> None:
        self.code = 'INVALID_PAYLOAD'
        self.raw_message = message

    @property
    def message(self) -> str:
        return f'Invalid payload: {self.raw_message}, code: {self.code}'


class ProviderError(BusinessLogicException):
    def __init__(self, message: str, code: str = 'PROVIDER_ERROR') -> None:
        self.code = code
        self.raw_message = message

    @property
    def message(self) -> str:
        return f'Provider error: {self.raw_message}, code: {self.code}'


class UnauthorizedError(BusinessLogicException):
    def __init__(self) -> None:
        self.code = 'UNAUTHORIZED'
        self.raw_message = 'Invalid bearer token'

    @property
    def message(self) -> str:
        return f'Unauthorized: {self.raw_message}, code: {self.code}'


class McpRequestError(BusinessLogicException):
    def __init__(self, server: 'McpServerSchema', error: dict[str, object]) -> None:
        self.server = server
        self.error = error

    @property
    def message(self) -> str:
        return f'Error from MCP server {self.server.name} at {self.server.url}: {self.error}'
