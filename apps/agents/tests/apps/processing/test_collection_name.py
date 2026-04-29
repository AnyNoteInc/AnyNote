from agents.apps.processing.utils import collection_name_for


def test_simple_slug() -> None:
    assert collection_name_for('ollama', 'nomic-embed-text') == 'pages_ollama_nomic-embed-text'


def test_normalizes_dots_and_underscores() -> None:
    assert collection_name_for('openai', 'text.embedding_3.small') == 'pages_openai_text-embedding-3-small'


def test_lowercases() -> None:
    assert collection_name_for('GigaChat', 'Embeddings') == 'pages_gigachat_embeddings'


def test_strips_leading_trailing_dashes() -> None:
    assert collection_name_for('ollama', '__bge.m3__') == 'pages_ollama_bge-m3'
