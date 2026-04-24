from agents.apps.processing.services.chunker import ChunkerService


def test_split_returns_stripped_chunks() -> None:
    service = ChunkerService()
    text = '  hello world  '
    result = service.split(text)
    assert result == ['hello world']


def test_split_drops_empty_chunks() -> None:
    service = ChunkerService()
    assert service.split('') == []
    assert service.split('   ') == []


def test_split_large_text_produces_multiple_chunks() -> None:
    service = ChunkerService()
    long = 'abcdefg ' * 200  # ~1600 chars
    result = service.split(long)
    assert len(result) >= 2
    assert all(len(c) <= 500 for c in result)
