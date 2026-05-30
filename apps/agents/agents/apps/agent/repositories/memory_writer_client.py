from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class MemoryWriterClient:
    web_base_url: str

    async def write_batch(self, *, jwt: str, entries: list[dict[str, Any]]) -> None:
        if not entries:
            return
        url = f'{self.web_base_url.rstrip("/")}/api/agent/memory-writes'
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                url,
                json={'entries': entries},
                headers={'Authorization': f'Bearer {jwt}'},
            )
            resp.raise_for_status()
