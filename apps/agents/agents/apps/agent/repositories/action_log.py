from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger(__name__)


@dataclass
class ActionLogRepository:
    web_base_url: str

    async def write_batch(self, *, jwt: str, entries: list[dict[str, Any]]) -> None:
        if not entries:
            return
        url = f'{self.web_base_url.rstrip("/")}/api/agent/action-log'
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    url,
                    json={'entries': entries},
                    headers={'Authorization': f'Bearer {jwt}'},
                )
        except Exception as exc:
            log.warning('action-log write failed: %s', exc)
