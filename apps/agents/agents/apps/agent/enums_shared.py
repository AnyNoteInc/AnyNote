from enum import StrEnum, auto


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
