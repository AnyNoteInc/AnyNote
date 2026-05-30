from enum import StrEnum, auto


class PlanStepStatus(StrEnum):
    PENDING = 'pending'
    RUNNING = 'running'
    DONE = 'done'
    FAILED = 'failed'
    SKIPPED = 'skipped'


class CriticVerdict(StrEnum):
    APPROVE = 'approve'
    REVISE = 'revise'
    REJECT = 'reject'


class RoutingKind(StrEnum):
    TRIVIAL = 'trivial'
    COMPLEX = 'complex'


class AgentMemoryScope(StrEnum):
    WORKSPACE = 'workspace'
    USER = 'user'


class ModelProviderEnum(StrEnum):
    OLLAMA = auto()
    OPENAI = auto()
    GIGACHAT = auto()
    YANDEXGPT = auto()
    ANTHROPIC = auto()
    DEEPSEEK = auto()


class RoleEnum(StrEnum):
    USER = auto()
    ASSISTANT = auto()
