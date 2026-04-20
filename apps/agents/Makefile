.PHONY: install lock sync dev test test-integration test-all lint format check-types revision migrate rollback clean

install: lock sync

lock:
	uv lock

sync:
	uv sync --frozen

dev:
	uv run uvicorn agents.cmd.rest:app --host 0.0.0.0 --port 8080 --reload

test:
	uv run pytest -m 'not integration'

test-integration:
	uv run pytest -m integration

test-all:
	uv run pytest

lint:
	uv run ruff check agents tests

format:
	uv run ruff format agents tests

check-types:
	uv run mypy agents tests

revision:
	uv run alembic revision --autogenerate -m "$(NAME)"

migrate:
	uv run alembic upgrade head

rollback:
	uv run alembic downgrade $(NUM)

clean:
	rm -rf .venv .pytest_cache .ruff_cache .mypy_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
