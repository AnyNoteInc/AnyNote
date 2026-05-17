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
