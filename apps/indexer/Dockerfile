FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_SYSTEM_PYTHON=1

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY indexer ./indexer

EXPOSE 8081

CMD ["uv", "run", "uvicorn", "--factory", "indexer.main:create_app", "--host", "0.0.0.0", "--port", "8081"]
