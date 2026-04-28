from collections.abc import AsyncIterator
from json import dumps

from .schemas import ServerEvent


def serialize_server_event(event: ServerEvent) -> dict[str, str]:
    return {
        'data': dumps(
            event.model_dump(mode='json', exclude_none=True),
            ensure_ascii=False,
            separators=(',', ':'),
        ),
    }


async def serialize_server_events(events: AsyncIterator[ServerEvent]) -> AsyncIterator[dict[str, str]]:
    async for event in events:
        yield serialize_server_event(event)
