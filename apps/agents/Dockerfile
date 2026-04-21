FROM python:3.13-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1

RUN pip install --no-cache-dir uv==0.5.*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
RUN uv run python -m spacy download ru_core_news_sm \
 && uv run python -m spacy download en_core_web_sm

COPY agents ./agents
COPY py.typed ./py.typed

EXPOSE 8080
CMD ["uv", "run", "uvicorn", "agents.cmd.rest:app", "--host", "0.0.0.0", "--port", "8080"]
