.PHONY: dev install lint typecheck test test-int format

dev:
	uv run uvicorn --factory indexer.main:create_app --host 0.0.0.0 --port 8081 --reload

install:
	uv sync

lint:
	uv run ruff check indexer tests

typecheck:
	uv run mypy indexer tests

test:
	uv run pytest -m 'not integration'

test-int:
	uv run pytest -m integration

format:
	uv run ruff format indexer tests
