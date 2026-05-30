from __future__ import annotations

from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

# (module, qualname) pairs for every custom type that can appear inside an
# AgentState checkpoint. Without this list LangGraph >=1.1 logs a warning on
# every load and threatens to block deserialization in a future release.
_ALLOWED_MSGPACK_MODULES: tuple[tuple[str, str], ...] = (
    ('agents.apps.agent.schemas', 'AgentContext'),
    ('agents.apps.agent.schemas', 'AgentState'),
    ('agents.apps.agent.schemas', 'CitationSchema'),
    ('agents.apps.agent.schemas', 'ConversationMessageSchema'),
    ('agents.apps.agent.schemas', 'McpServerSchema'),
    ('agents.apps.agent.schemas', 'MemoryItemSchema'),
    ('agents.apps.agent.schemas', 'MemoryWriteSchema'),
    ('agents.apps.agent.schemas', 'ModelConfigSchema'),
    ('agents.apps.agent.schemas', 'ModelSettingsSchema'),
    ('agents.apps.agent.schemas', 'PendingConfirmationSchema'),
    ('agents.apps.agent.schemas', 'PlanStepSchema'),
    ('agents.apps.agent.enums', 'AgentMemoryScope'),
    ('agents.apps.agent.enums', 'CriticVerdict'),
    ('agents.apps.agent.enums', 'PlanStepStatus'),
    ('agents.apps.agent.enums', 'RoutingKind'),
    ('agents.apps.agent.enums', 'ModelProviderEnum'),
    ('agents.apps.agent.enums', 'RoleEnum'),
    ('agents.apps.processing.schemas', 'EmbeddingProviderConfigSchema'),
    ('agents.apps.processing.schemas', 'ModelConnectionSchema'),
)


def build_checkpoint_serde() -> JsonPlusSerializer:
    return JsonPlusSerializer(allowed_msgpack_modules=list(_ALLOWED_MSGPACK_MODULES))
