.PHONY: dev install lint typecheck test test-int format

dev:
	uv run uvicorn --factory engines.main:create_app --host 0.0.0.0 --port 8082 --reload

install:
	uv sync

lint:
	uv run ruff check engines tests

typecheck:
	uv run mypy engines tests

test:
	uv run pytest -m 'not integration'

test-int:
	uv run pytest -m integration

format:
	uv run ruff format engines tests
