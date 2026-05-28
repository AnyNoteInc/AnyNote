from unittest.mock import AsyncMock, MagicMock

from agents.apps.processing.repositories.embedding_factory import EmbeddingFactoryRepository
from agents.apps.processing.schemas import EmbeddingValidationRequest
from agents.apps.processing.use_cases.validate_embedding import ValidateEmbeddingUseCase


async def test_validate_embedding_detects_vector_size() -> None:
    factory = MagicMock(spec=EmbeddingFactoryRepository)
    emb = MagicMock()
    emb.aembed_query = AsyncMock(return_value=[0.0] * 768)
    factory.make.return_value = emb
    uc = ValidateEmbeddingUseCase(embedding_factory=factory)
    res = await uc(EmbeddingValidationRequest(provider='ollama', modelSlug='nomic', connection={'baseUrl': 'http://o:1'}))
    assert res.ok is True
    assert res.vector_size == 768


async def test_validate_embedding_failure_is_caught() -> None:
    factory = MagicMock(spec=EmbeddingFactoryRepository)
    factory.make.side_effect = RuntimeError('no server')
    uc = ValidateEmbeddingUseCase(embedding_factory=factory)
    res = await uc(EmbeddingValidationRequest(provider='ollama', modelSlug='x', connection={}))
    assert res.ok is False
    assert 'no server' in (res.error or '')


async def test_validate_embedding_rejects_empty_vector() -> None:
    factory = MagicMock(spec=EmbeddingFactoryRepository)
    emb = MagicMock()
    emb.aembed_query = AsyncMock(return_value=[])
    factory.make.return_value = emb
    uc = ValidateEmbeddingUseCase(embedding_factory=factory)
    res = await uc(EmbeddingValidationRequest(provider='ollama', modelSlug='m', connection={'baseUrl': 'http://o:1'}))
    assert res.ok is False
    assert 'empty' in (res.error or '')
