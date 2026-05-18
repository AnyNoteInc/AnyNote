# Решения по архитектуре платежей

- Используем YooKassa как провайдера эквайринга.
- Тарифы фиксированы в таблице Plans (Free, Personal, Corporate).
- Renewal — ежедневный cron в apps/engines/apps/billing.
- Webhook-подпись проверяется в @repo/yookassa.

Ключевые решения:

Выбор YooKassa обусловлен поддержкой российских банковских карт и удобным API для рекуррентных платежей.

Plans хранятся в базе данных с атрибутами: maxWorkspaces, maxMembersPerWorkspace, chatsEnabled, pageIndexingEnabled.

Для безопасности все суммы хранятся в копейках (priceMonthlyKopecks, priceYearlyKopecks).

Webhook от YooKassa принимается на отдельном эндпоинте, подпись валидируется до любой бизнес-логики.
