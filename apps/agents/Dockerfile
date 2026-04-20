FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1

RUN pip install --no-cache-dir uv==0.5.*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY agents ./agents
COPY py.typed ./py.typed

EXPOSE 8080
CMD ["uv", "run", "uvicorn", "agents.cmd.rest:app", "--host", "0.0.0.0", "--port", "8080"]
