from enum import StrEnum, auto


class ModelProviderEnum(StrEnum):
    OLLAMA = auto()
    OPENAI = auto()
    GIGACHAT = auto()


class RoleEnum(StrEnum):
    USER = auto()
    ASSISTANT = auto()
