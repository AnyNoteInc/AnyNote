from agents.apps.agent.repositories.jinja_renderer import AgentJinjaRenderer
from agents.settings import settings


def test_router_template_renders_with_message():
    renderer = AgentJinjaRenderer(settings)
    out = renderer.render_router(user_message='Привет', chat_history=[])
    assert 'Привет' in out
    assert 'trivial' in out
    assert 'complex' in out


def test_planner_template_renders_without_extras():
    renderer = AgentJinjaRenderer(settings)
    out = renderer.render_planner(
        user_message='Найди договоры',
        chat_history=[],
        long_term_memories=[],
        rag_documents=[],
        mcp_servers=[],
        agent_system_prompt=None,
        last_critic_feedback=None,
    )
    assert 'Найди договоры' in out
    assert '(no relevant facts recorded)' in out


def test_executor_template_lists_plan():
    renderer = AgentJinjaRenderer(settings)
    out = renderer.render_executor(
        current_step={'id': '1', 'title': 'Найти страницы'},
        plan=[{'id': '1', 'status': 'running', 'title': 'Найти страницы'}],
        long_term_memories=[],
    )
    assert '1. [running] Найти страницы' in out


def test_critic_template_includes_revision_count():
    renderer = AgentJinjaRenderer(settings)
    out = renderer.render_critic(
        user_message='Q',
        plan=[],
        draft_answer='A',
        revision_count=1,
    )
    assert '1 / 2' in out
