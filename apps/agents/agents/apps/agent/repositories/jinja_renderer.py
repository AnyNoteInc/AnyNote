from __future__ import annotations

from os.path import join
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from agents.settings import SettingsSchema


class AgentJinjaRenderer:
    def __init__(self, settings: SettingsSchema) -> None:
        path = join(settings.base_dir, 'agents', 'apps', 'agent', 'templates')
        self.env = Environment(
            loader=FileSystemLoader(path),
            undefined=StrictUndefined,
            trim_blocks=True,
            lstrip_blocks=True,
        )

    def render_router(self, *, user_message: str, chat_history: list[Any]) -> str:
        return self.env.get_template('router.j2').render(
            user_message=user_message,
            chat_history=chat_history,
        )

    def render_planner(
        self,
        *,
        user_message: str,
        chat_history: list[Any],
        long_term_memories: list[Any],
        rag_documents: list[Any],
        mcp_servers: list[Any],
        agent_system_prompt: str | None,
        last_critic_feedback: str | None,
    ) -> str:
        return self.env.get_template('planner.j2').render(
            user_message=user_message,
            chat_history=chat_history,
            long_term_memories=long_term_memories,
            rag_documents=rag_documents,
            mcp_servers=mcp_servers,
            agent_system_prompt=agent_system_prompt,
            last_critic_feedback=last_critic_feedback,
        )

    def render_executor(
        self,
        *,
        current_step: dict[str, Any],
        plan: list[dict[str, Any]],
        long_term_memories: list[Any],
        chat_history: list[Any] | None = None,
    ) -> str:
        return self.env.get_template('executor.j2').render(
            current_step=current_step,
            plan=plan,
            long_term_memories=long_term_memories,
            chat_history=chat_history or [],
        )

    def render_critic(
        self,
        *,
        user_message: str,
        plan: list[Any],
        draft_answer: str,
        revision_count: int,
    ) -> str:
        return self.env.get_template('critic.j2').render(
            user_message=user_message,
            plan=plan,
            draft_answer=draft_answer,
            revision_count=revision_count,
        )
