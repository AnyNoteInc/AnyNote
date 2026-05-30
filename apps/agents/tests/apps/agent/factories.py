from uuid import uuid4

from agents.apps.agent.enums import ModelProviderEnum
from agents.apps.agent.schemas import AgentContext, AgentState, ModelConnectionSchema, ModelSettingsSchema


def make_context(**overrides) -> AgentContext:
    return AgentContext(
        user_id=uuid4(),
        workspace_id=uuid4(),
        chat_id=uuid4(),
        scopes=frozenset({'pages:read', 'pages:write', 'search:query',
                          'memory:read', 'memory:write'}),
        **overrides,
    )


def make_state(*, user_message: str = 'Hi', **overrides) -> AgentState:
    base: dict[str, object] = {
        'context': make_context(),
        'user_message': user_message,
        'chat_history': [],
        'model': {
            'provider': ModelProviderEnum.OPENAI,
            'name': 'gpt-4o-mini',
            'connection': ModelConnectionSchema(api_key='sk-test'),
            'settings': ModelSettingsSchema(temperature=0.2),
        },
        'embedding_config': None,
        'mcp_servers': [],
        'agent_system_prompt': None,
        'long_term_memories': [],
    }
    base.update(overrides)
    return AgentState.model_validate(base)
