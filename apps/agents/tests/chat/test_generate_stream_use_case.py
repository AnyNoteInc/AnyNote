from __future__ import annotations

import json

import pytest

from agents.apps.chat.schemas import ServerEvent
from agents.apps.chat.use_cases.generate_stream import normalize_event


@pytest.mark.asyncio
async def test_normalize_event_maps_token_message() -> None:
    payload = normalize_event(ServerEvent.token("x"))
    assert json.loads(payload)["type"] == "token"
