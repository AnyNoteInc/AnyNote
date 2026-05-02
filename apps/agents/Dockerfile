# syntax=docker/dockerfile:1.7

# ---- Stage 1: prepare (Node container, uses turbo prune to extract agents subworkspace) ----
FROM node:24-alpine AS prepare

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache libc6-compat
RUN corepack enable pnpm
WORKDIR /app

RUN pnpm add turbo --global
COPY . .
RUN turbo prune agents --docker

# ---- Stage 2: builder (Python, install deps + spaCy models) ----
FROM python:3.13-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1

RUN pip install --no-cache-dir uv==0.5.*

WORKDIR /app

# Pull pyproject.toml + uv.lock from the pruned subworkspace
COPY --from=prepare /app/out/full/apps/agents/pyproject.toml ./pyproject.toml
COPY --from=prepare /app/out/full/apps/agents/uv.lock ./uv.lock

RUN uv sync --frozen --no-dev
RUN uv run python -m spacy download ru_core_news_sm \
 && uv run python -m spacy download en_core_web_sm

COPY --from=prepare /app/out/full/apps/agents/agents ./agents
COPY --from=prepare /app/out/full/apps/agents/py.typed ./py.typed

# ---- Stage 3: runner (slim final image) ----
FROM python:3.13-slim AS runner

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN addgroup --system --gid 1001 agents && adduser --system --uid 1001 --ingroup agents agents

WORKDIR /app
COPY --from=builder --chown=agents:agents /app /app

USER agents

EXPOSE 8080
CMD ["/app/.venv/bin/uvicorn", "agents.cmd.rest:app", "--host", "0.0.0.0", "--port", "8080"]
