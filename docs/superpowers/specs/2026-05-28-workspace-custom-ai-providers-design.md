# Кастомные LLM / embeddings / MCP-серверы в пространстве — Design

**Статус:** Approved, ready for implementation plan
**Дата:** 2026-05-28
**Scope:** Дать владельцу пространства возможность, помимо выбора **общих** (seeded) LLM/embedding-моделей, регистрировать **собственные** провайдеры (ollama, openai, gigachat, yandexgpt, anthropic, deepseek) с шифрованными кредами и собственные MCP-серверы по ссылке. Перед сохранением любого провайдера/модели/MCP делается живой ping-pong (block-on-fail). Менять конфигурацию может только владелец.

## Goal

В каждом пространстве:

1. Выбирать общие LLM и embedding-модели из заранее установленного списка (уже работает) **и** добавлять свои провайдеры с собственными кредами, которые шифруются. Кастомные модели появляются в тех же селекторах, что и общие.
2. Добавлять собственные MCP-серверы по URL. Дефолтный `anynote` присутствует всегда (read-only), остальные добавляются/удаляются.
3. Перед добавлением/изменением провайдера, модели или MCP-сервера выполнять ping-pong (LLM/embeddings/MCP) и сохранять только рабочую конфигурацию.
4. Изменять LLM/embeddings/MCP может **только владелец** (OWNER).

## Non-goals

- OAuth-флоу для MCP-серверов (как в public-api-mcp spec) — остаётся заголовочная авторизация (`headers`).
- Шифрование кредов **общих** seeded-провайдеров — они остаются в `AiProvider.connection` (plaintext, админ-управляемые). Шифруем только воркспейсные.
- Автоматический реиндекс при смене embedding-модели — поведение уже есть в `aiSettings.update`, не трогаем.
- Тонкая настройка прав ADMIN — по ТЗ менять может только OWNER; ADMIN исключён намеренно.
- Биллинг/тарифные цены — добавляется только feature-флаг `customAiProvidersEnabled`.

## Текущее состояние (что переиспользуем)

- **Данные:** `AiProvider` (slug/name/`connection` JSON plaintext) → `AiModel` (slug/displayName/contextTokens/supportsEmbeddings/vectorSize/minPlanSlug). `WorkspaceAiSettings` выбирает `defaultModelId`/`embeddingsModelId` из `AiModel`. `WorkspaceMcpServer` (url/transport/`headers` **шифрованные**/toolsAllowlist/verifyTls/enabled). Enum `RoleType` (OWNER…), `McpTransport` (HTTP_JSONRPC/SSE).
- **Шифрование:** `packages/auth/src/secret-encryption.ts` — AES-256-GCM, ключ `SECRETS_ENCRYPTION_KEY`. Уже применяется к headers MCP.
- **tRPC:** `aiSettingsRouter` (get/update/listAvailableModels/listAvailableEmbeddingModels — авторизация только `assertWorkspaceMember`). `mcpServerRouter` (list — все роли; create/update/delete — **OWNER only**, headers шифруются).
- **apps/agents:** `ModelProviderEnum {OLLAMA,OPENAI,GIGACHAT}`, `ModelFactoryRepository.make()`, `EmbeddingFactoryRepository.make()`, `ModelConnectionSchema {base_url, api_key, organization, client_id, client_secret, scope}`, `McpClient.list_tools/call_tool` (HTTP JSON-RPC + SSE, кастомные headers). **Валидации провайдеров нет нигде.**
- **payload:** `apps/web/.../api/agents/generate/route.ts` читает `WorkspaceAiSettings` + провайдеров, отправляет `provider: provider.slug` и `connection`. Дефолтный MCP `anynote` подставляется из `ENGINES_MCP_URL`. Авторизация web→agents — HS256 JWT через `apps/web/src/lib/agents-token.ts` (`signAgentsJwt`, claims `wsid`/`sub`, ключ `AGENTS_JWT_SECRET`).
- **Plan:** boolean-флаги (`aiSettingsEnabled`, `customMcpEnabled`, …). Сид: personal=всё false; pro=aiSettingsEnabled; max=+customMcpEnabled.

## Architecture overview

```
            Browser (owner)                         tRPC (в apps/web, Node)
   /workspaces/[id]/settings/ai   ──► aiProvider.create / aiModel.create
   /workspaces/[id]/settings/mcp  ──► mcpServer.create / update
                                            │ 1) ping-pong (plaintext creds)
                                            ▼
                              apps/agents  POST /validate/{llm,embedding,mcp}
                              (переиспользует ModelFactory / EmbeddingFactory / McpClient)
                                            │ {ok, error?, vectorSize?, tools?}
                                            ▼
                                  2) при ok: encryptSecret(creds)
                                  3) prisma.$transaction → запись строк
                                     (при fail — TRPCError, ничего не пишем)
```

### Решение по валидации

Валидацию делает **apps/agents** — там живут все клиенты провайдеров и `McpClient`. Альтернативы (валидация в TS/tRPC или в engines) отклонены: LLM/embedding-клиенты только в Python, дублировать SDK в Node нерационально. tRPC вызывает agents по HS256-JWT (тот же механизм, что `/agent/run`).

«Ping-pong в транзакции / block-on-fail» трактуется так: мутация (1) валидирует через agents по plaintext-кредам, (2) при успехе шифрует креды и (3) пишет строки в `prisma.$transaction` (атомарно провайдер+модели). При провале — `TRPCError`, в БД ничего не попадает. Настоящую SQL-транзакцию через сетевой ping не держим (избегаем долгих блокировок строк). Если agents недоступен/таймаут — проверка считается проваленной (fail-closed) и сохранение блокируется.

## Изменения по слоям

### 1. Схема БД (`packages/db/prisma/schema.prisma` + миграция)

```prisma
enum AiProviderKind { OLLAMA OPENAI GIGACHAT YANDEXGPT ANTHROPIC DEEPSEEK }

model AiProvider {
  // существующие: id, slug, name, connection (Json, plaintext), isActive, timestamps, models[]
  kind          AiProviderKind                  // NEW — дискриминатор для apps/agents
  workspaceId   String?    @db.Uuid             // NEW — NULL = общий/seeded; иначе кастомный
  connectionEnc Json?                           // NEW — шифрованные креды воркспейс-провайдера
  createdById   String?    @db.Uuid             // NEW
  workspace     Workspace? @relation("WorkspaceAiProviders", fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy     User?      @relation("AiProviderCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)

  @@index([workspaceId])
  // slug: снять глобальный @unique. Добавить @@unique([workspaceId, slug])
  //       + partial unique index (slug) WHERE workspace_id IS NULL — raw SQL в миграции
}
```

- **Backfill миграции:** `kind = upper(slug)::AiProviderKind` для существующих строк (`ollama/openai/gigachat`); `workspaceId = NULL`.
- `AiModel` — scope наследуется от провайдера (отдельный `workspaceId` не нужен). `@@unique([providerId, slug])` остаётся. Добавляем `createdById String? @db.Uuid` (для аудита). Кастомные модели висят на кастомном провайдере.
- `Plan` += `customAiProvidersEnabled Boolean @default(false) @map("custom_ai_providers_enabled")`. Сид: pro/max — по решению (по умолчанию включаем там же, где `customMcpEnabled`, т.е. на `max`; подтвердить при планировании).
- `Workspace` += обратная связь `aiProviders AiProvider[] @relation("WorkspaceAiProviders")`.
- Удаляем неиспользуемые `WorkspaceAiSettings.chatModelConnection` / `embeddingModelConnection` (их заменяет библиотека). *(опциональная чистка; если рискованно — оставить)*

**Скоуп выборки моделей** (`listAvailableModels` / `listAvailableEmbeddingModels`):
`where provider: { isActive: true, OR: [{ workspaceId: null }, { workspaceId }] }` — общие + только свои воркспейсные. Чужие воркспейсные не утекают.

### 2. apps/agents — 6 провайдеров + валидация

- `ModelProviderEnum` += `YANDEXGPT, ANTHROPIC, DEEPSEEK`.
- `model_factory.py`:
  - **anthropic** → `ChatAnthropic` (пакет `langchain-anthropic`), creds: `api_key`.
  - **deepseek** → OpenAI-совместимый: `ChatDeepSeek` (`langchain-deepseek`) или `ChatOpenAI` с `base_url=https://api.deepseek.com`, creds: `api_key`.
  - **yandexgpt** → `yandex-chain`/community-интеграция, creds: `api_key` + `folder_id`.
- `ModelConnectionSchema` += `folder_id: str | None` (yandex).
- `embedding_factory.py`: добавляем только **yandexgpt** (у anthropic/deepseek нет embedding-API). В UI это отражается через `AiModel.supportsEmbeddings`.
- **Новые валидационные эндпоинты** (use-case + контроллер, защищены тем же JWT, что `/agent/run`):
  - `POST /validate/llm` — собрать модель фабрикой, `ainvoke("ping")` c минимальным выводом, таймаут ~10с → `{ ok, error? }`.
  - `POST /validate/embedding` — `embed_query("ping")` → `{ ok, vectorSize, error? }` (детектируем реальную размерность).
  - `POST /validate/mcp` — `McpClient.list_tools(server)` → `{ ok, tools: string[], error? }` (проверяет url + transport + headers/auth).
  - Тела запросов используют существующие схемы (`ModelConfigSchema` / `EmbeddingProviderConfigSchema` / `McpServerSchema`).

### 3. tRPC + авторизация (`packages/trpc/src/routers/`)

- **Новый `aiProviderRouter`:** `list`, `create`, `update`, `delete` (и управление моделями: `addModel`, `updateModel`, `deleteModel` — отдельным роутером `aiModel` либо вложенно). Все мутации: **OWNER only** + план `customAiProvidersEnabled`.
  - `create`/`update`/`addModel`: вызвать agents-валидацию по plaintext-кредам → при ok зашифровать `connectionEnc` → `prisma.$transaction` запись. Креды в ответах **не отдаём** (как `mcpServer.list` отдаёт headers stripped).
  - `addModel` для embedding-модели: брать `vectorSize` из ответа `/validate/embedding`.
- **`aiSettings.update`:** ужесточить до **OWNER** (сейчас любой участник). Чтения (`get`, `listAvailable*`) — на уровне участника.
- **`mcpServerRouter`:** записи уже OWNER; **добавить ping** `POST /validate/mcp` перед персистом (block-on-fail); добавить план-гейт `customMcpEnabled`. `list` — без изменений, headers по-прежнему stripped.
- **Шаред-модуль для agents JWT:** вынести `signAgentsJwt` из `apps/web/src/lib/agents-token.ts` в место, доступное и для `packages/trpc` (напр. `packages/auth` или новый `packages/agents-client`); web-роуты переключить на тот же импорт. tRPC-валидатор абстрагируется за интерфейсом, чтобы юнит-тесты его мокали.

### 4. Сборка payload (`apps/web/.../api/agents/generate/route.ts`, `lib/chat/agents-payload.ts`)

- Отправлять `provider: provider.kind` (не `slug`).
- Хелпер `resolveProviderConnection(provider)`: воркспейс-провайдер → `decryptSecret(connectionEnc)`; общий → `connection` (как сейчас). Применить и к chat-модели, и к embedding-модели.
- MCP-часть без изменений (engines `anynote` + расшифрованные воркспейсные сервера).

### 5. Web UI (`apps/web/src`)

- **AI-настройки** (`components/workspace/settings/ai-section.tsx`): селекторы «модель по умолчанию» и «векторизация» уже тянут `listAvailableModels`/`listAvailableEmbeddingModels` — кастомные появятся автоматически. Добавить блок **«Свои провайдеры»**: список провайдеров + диалоги «Добавить провайдера» (поля: `kind`, имя, `baseUrl`/`organization`/`scope`/`folderId`, секреты) и «Добавить модель» (`slug`, `displayName`, `contextTokens`, `supportsEmbeddings`). Кнопки видны только владельцу; при сохранении — спиннер «Проверка соединения…», ошибки ping показываются у формы.
- **MCP** → перенести в настройки пространства: новый раздел `/workspaces/[id]/settings/mcp` + пункт «MCP серверы» в `components/workspace/workspace-settings-nav.tsx`. Дефолтный `anynote` — read-only always-on строка; пользовательские — из `mcpServer.list`. После ping диалог показывает найденные тулзы. Старый `/settings/integrations/mcp` убрать (с редиректом на новый раздел текущего/дефолтного пространства).

### 6. Шифрование, план-гейтинг, ошибки

- Шифрование — существующий `secret-encryption.ts` (`SECRETS_ENCRYPTION_KEY`), та же схема `{iv, ciphertext, tag}`, что у MCP headers.
- План-гейтинг через `getWorkspaceFeatures(workspaceId)` (как `customMcpEnabled`): без флага — мутации кастомных провайдеров запрещены, UI-кнопки скрыты.
- Ошибки:
  - ping-fail → `TRPCError({ code: 'BAD_REQUEST' })` с очищенным сообщением провайдера («Не удалось подключиться: …»).
  - agents недоступен/таймаут → блок с «Сервис проверки недоступен» (fail-closed).
  - нет `SECRETS_ENCRYPTION_KEY`/`AGENTS_JWT_SECRET` → 500 конфиг-ошибка.
  - ошибка расшифровки при чтении → провайдер помечается «битым» в UI.
  - Таймауты: LLM/embedding ~10с, MCP ~8с.

## Data flow: добавление кастомного провайдера + модели

1. Владелец → `/workspaces/[id]/settings/ai` → «Добавить провайдера»: выбирает `kind=anthropic`, имя, `api_key`.
2. `aiProvider.create` (OWNER + план): mint agents-JWT → `POST /validate/llm` (минимальная проверка коннекта) → ok → `encryptSecret({api_key})` → `prisma.$transaction` создаёт `AiProvider {kind, workspaceId, name, slug=generated, connectionEnc}`.
3. «Добавить модель»: `slug=claude-3-5-sonnet`, `contextTokens`, `supportsEmbeddings=false`. `aiModel.addModel` → `POST /validate/llm` уже с конкретной моделью → ok → `prisma` создаёт `AiModel`.
4. Модель появляется в селекторе «модель по умолчанию». Владелец выбирает её → `aiSettings.update` (теперь OWNER-only).
5. На следующем чате `route.ts` собирает payload с `provider=anthropic` и расшифрованным `connection`.

Для embedding-провайдера шаг 3 использует `/validate/embedding`, размерность берётся из ответа (`vectorSize`) и сохраняется в `AiModel.vectorSize`.

## Тестирование

- **trpc (vitest):** мок agents-валидатора. Проверяем: block-on-fail (ping fail → нет записи), при ok creds зашифрованы и сохранены, OWNER-only (не-владелец → FORBIDDEN), план-гейт, креды не возвращаются клиенту, `aiSettings.update` теперь OWNER-only.
- **agents (pytest):** юнит-тесты 6 фабрик LLM (+ yandex embeddings) c мок-клиентами; 3 валидационных эндпоинта (`/validate/llm|embedding|mcp`) — успех/ошибка (мок провайдер-вызовов, httpx-мок для MCP `tools/list`).
- **E2E (playwright):** владелец добавляет кастомного провайдера (agents `/validate/*` замокан на успех в Playwright-режиме) → модель видна в селекторе; не-владелец не видит кнопок управления; flow добавления MCP-сервера с показом тулзов; дефолтный `anynote` отображается read-only.

## Открытые вопросы / подтвердить при планировании

- На каких тарифах включать `customAiProvidersEnabled` (предложение: как `customMcpEnabled` — на `max`).
- Точное место шаред-модуля `signAgentsJwt` (`packages/auth` vs новый `packages/agents-client`).
- Удалять ли `WorkspaceAiSettings.chatModelConnection`/`embeddingModelConnection` сейчас или отдельной чисткой.
- Имена коллекций Qdrant для кастомных embedding (сейчас `collection_name_for(provider, model_slug)` шарится между воркспейсами с фильтром по `workspace_id`) — оставляем как есть; зафиксировать как осознанное решение.

## Ориентир по последовательности сборки

1. Миграция схемы (`AiProviderKind`, поля `AiProvider`, `Plan.customAiProvidersEnabled`) + backfill + сид.
2. apps/agents: 6 провайдеров + 3 валидационных эндпоинта + тесты.
3. Шаред `signAgentsJwt` + agents-валидатор-клиент в tRPC.
4. tRPC: `aiProvider`/`aiModel` роутеры, OWNER-гейтинг `aiSettings.update`, ping в `mcpServer.*` + тесты.
5. payload: `kind` + `resolveProviderConnection`.
6. UI: блок «Свои провайдеры» в ai-section; раздел MCP в настройках пространства + nav; редирект старого пути.
7. E2E + gates (`pnpm gates`).
