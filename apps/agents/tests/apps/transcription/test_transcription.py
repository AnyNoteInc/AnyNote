import base64
import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI

# Ensure AGENTS_JWT_SECRET is available even if .env wasn't loaded (router test
# builds the real container, whose JwtVerifierService needs the secret).
os.environ.setdefault('AGENTS_JWT_SECRET', base64.b64encode(b'0' * 32).decode())

from agents.apps.agent.errors import InvalidPayloadError
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.schemas import ModelConfigSchema
from agents.apps.transcription.repositories.s3_storage import S3StorageRepository
from agents.apps.transcription.repositories.transcription_factory import (
    MockTranscriptionAdapter,
    RealTranscriptionAdapter,
    TranscriptionFactory,
)
from agents.apps.transcription.schemas import (
    SummarizeRequestSchema,
    TranscribeRequestSchema,
)
from agents.apps.transcription.use_cases.summarize import SummarizeUseCase
from agents.apps.transcription.use_cases.transcribe import TranscribeUseCase

# --- transcription factory: provider selection ---


def test_factory_returns_mock_adapter_for_mock_provider() -> None:
    adapter = TranscriptionFactory.make('mock')
    assert isinstance(adapter, MockTranscriptionAdapter)


def test_factory_returns_real_adapter_for_real_provider() -> None:
    adapter = TranscriptionFactory.make('whisper')
    assert isinstance(adapter, RealTranscriptionAdapter)


def test_factory_unknown_provider_raises() -> None:
    with pytest.raises(InvalidPayloadError, match='Unknown'):
        TranscriptionFactory.make('does-not-exist')


# --- mock adapter: deterministic segments, no real S3 ---


async def test_mock_adapter_returns_deterministic_segments_without_s3() -> None:
    adapter = MockTranscriptionAdapter()
    # mock ignores the bytes entirely — pass empty bytes, no S3 needed
    result_a = await adapter.transcribe(b'', mime_type='audio/mp3', language=None)
    result_b = await adapter.transcribe(b'', mime_type='audio/mp3', language=None)

    assert len(result_a.segments) > 0
    # deterministic: same input → identical output
    assert [s.model_dump() for s in result_a.segments] == [s.model_dump() for s in result_b.segments]

    first = result_a.segments[0]
    assert first.idx == 0
    assert first.start_ms == 0
    assert first.end_ms > first.start_ms
    assert first.text
    # ordinals are contiguous and monotonic timing
    pairs = zip(result_a.segments, result_a.segments[1:], strict=False)
    for prev, nxt in pairs:
        assert nxt.idx == prev.idx + 1
        assert nxt.start_ms >= prev.end_ms
    assert result_a.duration_ms == result_a.segments[-1].end_ms


async def test_real_adapter_is_not_invoked_in_ci() -> None:
    adapter = RealTranscriptionAdapter()
    with pytest.raises(NotImplementedError):
        await adapter.transcribe(b'\x00\x01', mime_type='audio/mp3', language=None)


# --- transcribe use case ---


async def test_transcribe_use_case_mock_skips_s3() -> None:
    s3 = MagicMock(spec=S3StorageRepository)
    s3.get_bytes = AsyncMock(side_effect=AssertionError('S3 must not be read for the mock provider'))
    uc = TranscribeUseCase(s3=s3, factory=TranscriptionFactory())
    payload = TranscribeRequestSchema(
        workspaceId='w1',
        recordingS3Key='ws/w1/rec.mp3',
        mimeType='audio/mp3',
        provider='mock',
    )
    res = await uc(payload)
    s3.get_bytes.assert_not_called()
    assert len(res.segments) > 0
    assert res.duration_ms == res.segments[-1].end_ms


async def test_transcribe_use_case_real_reads_s3() -> None:
    s3 = MagicMock(spec=S3StorageRepository)
    s3.get_bytes = AsyncMock(return_value=b'\x00\x01\x02')
    uc = TranscribeUseCase(s3=s3, factory=TranscriptionFactory())
    payload = TranscribeRequestSchema(
        workspaceId='w1',
        recordingS3Key='ws/w1/rec.mp3',
        mimeType='audio/mp3',
        provider='whisper',
    )
    # real adapter raises NotImplementedError but S3 must be read first
    with pytest.raises(NotImplementedError):
        await uc(payload)
    s3.get_bytes.assert_awaited_once_with('ws/w1/rec.mp3')


# --- summarize use case: mocked factory + mocked ainvoke ---


def _summarize_request() -> SummarizeRequestSchema:
    return SummarizeRequestSchema(
        model=ModelConfigSchema(provider='openai', name='gpt', connection={'apiKey': 'k'}),
        transcript='Alice: ship Friday. Bob: I will write the docs.',
        summaryInstruction=None,
    )


async def test_summarize_returns_summary_and_action_items() -> None:
    factory = MagicMock(spec=ModelFactoryRepository)
    llm = MagicMock()
    llm.ainvoke = AsyncMock(
        return_value=MagicMock(content='{"summary": "Ship on Friday.", "action_items": ["Bob writes the docs"]}')
    )
    factory.make.return_value = llm
    uc = SummarizeUseCase(model_factory=factory)

    res = await uc(_summarize_request())

    assert res.summary == 'Ship on Friday.'
    assert res.action_items == ['Bob writes the docs']


async def test_summarize_parses_json_in_fenced_block() -> None:
    factory = MagicMock(spec=ModelFactoryRepository)
    llm = MagicMock()
    llm.ainvoke = AsyncMock(
        return_value=MagicMock(content='```json\n{"summary": "S", "action_items": ["a", "b"]}\n```')
    )
    factory.make.return_value = llm
    uc = SummarizeUseCase(model_factory=factory)

    res = await uc(_summarize_request())
    assert res.summary == 'S'
    assert res.action_items == ['a', 'b']


async def test_summarize_defensive_on_unparseable_response() -> None:
    factory = MagicMock(spec=ModelFactoryRepository)
    llm = MagicMock()
    llm.ainvoke = AsyncMock(return_value=MagicMock(content='not json at all'))
    factory.make.return_value = llm
    uc = SummarizeUseCase(model_factory=factory)

    res = await uc(_summarize_request())
    # falls back to the raw text as summary, no action items — never crashes
    assert 'not json at all' in res.summary
    assert res.action_items == []


async def test_summarize_make_error_is_caught() -> None:
    # the run_agent.py:90 footgun — make() must be INSIDE try/except so a config
    # error returns a clean ProviderError, not an unhandled exception.
    from agents.apps.agent.errors import ProviderError

    factory = MagicMock(spec=ModelFactoryRepository)
    factory.make.side_effect = InvalidPayloadError('OpenAI provider requires an api_key')
    uc = SummarizeUseCase(model_factory=factory)

    with pytest.raises(ProviderError) as ei:
        await uc(_summarize_request())
    # a controlled provider error, not a bare AttributeError/TypeError from make()
    assert 'api_key' in str(ei.value.message)


# --- router: service-token gated + provider=mock returns segments ---


def _app() -> FastAPI:
    from agents.bootstrap import create_app
    from agents.router import apply_routes

    return create_app([apply_routes])


def _service_token() -> str:
    import time

    import jwt

    secret = base64.b64decode(os.environ['AGENTS_JWT_SECRET'])
    claims = {
        'sub': 'u1',
        'wsid': 'w1',
        'aud': os.environ.get('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents'),
        'exp': int(time.time()) + 60,
    }
    return jwt.encode(claims, secret, algorithm='HS256')


def test_transcription_route_rejects_bad_token() -> None:
    from fastapi.testclient import TestClient

    with TestClient(_app()) as client:
        res = client.post(
            '/transcription',
            headers={'Authorization': 'Bearer not.a.jwt'},
            json={
                'workspaceId': 'w1',
                'recordingS3Key': 'ws/w1/rec.mp3',
                'mimeType': 'audio/mp3',
                'provider': 'mock',
            },
        )
    assert res.status_code == 401


def test_transcription_route_mock_returns_segments() -> None:
    from fastapi.testclient import TestClient

    with TestClient(_app()) as client:
        res = client.post(
            '/transcription',
            headers={'Authorization': f'Bearer {_service_token()}'},
            json={
                'workspaceId': 'w1',
                'recordingS3Key': 'ws/w1/rec.mp3',
                'mimeType': 'audio/mp3',
                'provider': 'mock',
            },
        )
    assert res.status_code == 200
    body = res.json()
    assert len(body['segments']) > 0
    seg = body['segments'][0]
    assert seg['idx'] == 0
    assert 'startMs' in seg
    assert 'endMs' in seg
    assert seg['text']


def test_summarize_route_rejects_bad_token() -> None:
    from fastapi.testclient import TestClient

    with TestClient(_app()) as client:
        res = client.post(
            '/meeting/summarize',
            headers={'Authorization': 'Bearer not.a.jwt'},
            json={
                'model': {'provider': 'openai', 'name': 'gpt', 'connection': {'apiKey': 'k'}},
                'transcript': 'hello',
            },
        )
    assert res.status_code == 401
