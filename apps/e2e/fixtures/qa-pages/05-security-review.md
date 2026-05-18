# Security review

## Обзор безопасности платёжной подсистемы

### YooKassa и Webhook-подпись

Все входящие webhook-события от YooKassa проходят проверку подписи. Подпись верифицируется в @repo/yookassa до выполнения любой бизнес-логики. Используется HMAC-SHA256 с секретом YOOKASSA_SECRET.

### Хранение секретов

API-ключи провайдеров ИИ хранятся зашифрованными: AES-256-GCM через SECRETS_ENCRYPTION_KEY. Расшифровка происходит только в момент обращения к провайдеру.

### YooKassa провайдер

YooKassa — единственный поддерживаемый платёжный шлюз. Интеграция через @repo/yookassa, Plans с тарифами (Free, Personal, Corporate), Renewal через cron.

### Аутентификация

better-auth с поддержкой JWT, Google OAuth, email-верификацией и reCAPTCHA v3.

Между apps/agents и apps/engines используется HMAC-аутентификация (AGENTS_TO_ENGINES_SECRET).
