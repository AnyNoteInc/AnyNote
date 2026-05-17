# Vendor list

## Внешние сервисы

| Сервис | Назначение | Пакет/конфиг |
|--------|-----------|--------------|
| YooKassa | Платёжный шлюз (эквайринг) | @repo/yookassa |
| SendSay | Транзакционные email | @repo/mail |
| Google OAuth | Социальный вход | better-auth socialProviders |
| OpenAI | LLM и embedding модели | WorkspaceAiSettings |
| Ollama | Self-hosted LLM/embedding | WorkspaceAiSettings |
| GigaChat | Российский LLM | WorkspaceAiSettings |
| MinIO | S3-совместимое хранилище | @repo/storage |
| Qdrant | Векторная БД для RAG | apps/agents |
| PostgreSQL | Основная реляционная БД | @repo/db |

## Инфраструктура

Docker Compose: postgres (5432), MinIO (9000/9001), Qdrant (6333/6334), Gotenberg (3001).

Для локальной разработки LLM-провайдеры настраиваются вручную в Settings → AI агент.
