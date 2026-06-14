"""Summarize use case: one-shot LLM call producing {summary, action_items}.

Mirrors validate_provider.py — `model_factory.make(config)` is INSIDE the
try/except (the run_agent.py:90 footgun: a config error from make() must NOT
escape as an unhandled exception). The model is instructed to return JSON; the
response is parsed defensively (fenced blocks, embedded objects, raw-text
fallback) so a non-conforming model never crashes the pipeline.
"""

import asyncio
import json
import re
from dataclasses import dataclass

from agents.apps.agent.errors import ProviderError
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository

from ..schemas import SummarizeRequestSchema, SummarizeResponseSchema

_LLM_TIMEOUT = 60.0

_SYSTEM_PROMPT = (
    'Ты помощник, который делает конспект встречи по её транскрипту. '
    'Верни СТРОГО JSON-объект с двумя полями: '
    '"summary" — краткое связное резюме встречи на языке транскрипта (markdown допустим), '
    'и "action_items" — массив строк с конкретными задачами/решениями. '
    'Не добавляй ничего кроме JSON.'
)


def _coerce_content(raw: object) -> str:
    """LangChain message .content may be a str or a list of content blocks."""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        parts: list[str] = []
        for block in raw:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get('text'), str):
                parts.append(block['text'])
        return '\n'.join(parts)
    return str(raw)


def _extract_json(text: str) -> dict[str, object] | None:
    """Pull a JSON object out of the model output, tolerating fences/prose."""
    candidates: list[str] = []
    fenced = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if fenced:
        candidates.append(fenced.group(1))
    candidates.append(text.strip())
    brace = re.search(r'\{.*\}', text, re.DOTALL)
    if brace:
        candidates.append(brace.group(0))
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _parse(text: str) -> SummarizeResponseSchema:
    obj = _extract_json(text)
    if obj is None:
        # defensive: never crash — fall back to the raw text as the summary
        return SummarizeResponseSchema(summary=text.strip(), action_items=[])
    summary = obj.get('summary')
    raw_items = obj.get('action_items')
    items: list[str] = []
    if isinstance(raw_items, list):
        items = [str(item).strip() for item in raw_items if str(item).strip()]
    return SummarizeResponseSchema(
        summary=str(summary).strip() if summary is not None else text.strip(),
        action_items=items,
    )


@dataclass
class SummarizeUseCase:
    model_factory: ModelFactoryRepository

    async def __call__(self, payload: SummarizeRequestSchema) -> SummarizeResponseSchema:
        try:
            llm = self.model_factory.make(payload.model)
        except Exception as exc:  # config/provider error — clean, not a crash
            raise ProviderError(str(exc) or 'failed to build the model') from exc

        instruction = payload.summary_instruction or ''
        user_prompt = (
            (f'Дополнительная инструкция к резюме: {instruction}\n\n' if instruction.strip() else '')
            + 'Транскрипт встречи:\n'
            + payload.transcript
        )
        try:
            async with asyncio.timeout(_LLM_TIMEOUT):
                message = await llm.ainvoke(
                    [
                        ('system', _SYSTEM_PROMPT),
                        ('human', user_prompt),
                    ]
                )
        except Exception as exc:
            raise ProviderError((str(exc) or f'timed out after {_LLM_TIMEOUT:.0f}s')[:500]) from exc

        return _parse(_coerce_content(message.content))
