REST API v1 — программный доступ к рабочим пространствам AnyNote: страницы,
файлы, поиск. Все запросы выполняются к серверу AnyNote Engines
(облако — `https://api.anynote.ru`, self-hosted — адрес вашего сервера Engines).

## Аутентификация

API использует персональные ключи. Создайте ключ в **Настройки → API-ключи**
(`/settings/api`) и передавайте его в каждом запросе:

```http
Authorization: Bearer ank_XXXXXXXXXXXXXXXXXXXXXXXX
```

- Формат ключа: префикс `ank_` + 24 символа base62 (`A–Z`, `a–z`, `0–9`).
- Полный ключ показывается **только один раз** — в момент создания. В списке
  ключей видны лишь первые 8 и последние 4 символа. На сервере хранится только
  SHA-256-хеш ключа.
- Срок действия выбирается при создании: `7d`, `30d`, `90d`, `1y`, `never`.
- Ключ можно отозвать в любой момент — отзыв действует немедленно.
- Поле «последнее использование» (`lastUsedAt`) обновляется не чаще одного раза
  в 60 секунд.

Запрос без корректного заголовка `Authorization: Bearer ank_…` отклоняется со
статусом 401. Для ключей сервер различает три причины отказа (текст в поле
`message` ответа — дословно):

| Статус | Сообщение | Причина |
| --- | --- | --- |
| 401 | `Invalid API key` | ключ не найден (опечатка или удалён) |
| 401 | `API key revoked` | ключ отозван |
| 401 | `API key expired` | истёк срок действия ключа |

## Формат запросов и ошибок

- Кроме `GET /healthz`, `GET /v1/meta` и `GET /v1/workspaces`, все эндпоинты
  принимают `POST` с JSON-телом (`Content-Type: application/json`).
- Неизвестные поля тела запроса отбрасываются; нарушение ограничений полей —
  ответ `400 Bad Request` со списком ошибок валидации.
- Доступ всегда проверяется по членству: если пользователь ключа не состоит в
  указанном `workspaceId`, сервер отвечает `403 Forbidden`.
- Прикладные ошибки возвращают JSON с машинным кодом, например:
  `{"code": "PAGE_NOT_FOUND", "message": "PAGE_NOT_FOUND: page … not found"}` (404).
- Списочные эндпоинты используют пагинацию `limit`/`offset` (для файлов
  `limit` не больше 200).

## Служебные эндпоинты

### GET /healthz

Проверка живости. Без аутентификации.

Ответ:

```json
{ "status": "ok" }
```

### GET /v1/meta

Метаданные сервера. Без аутентификации.

Ответ:

```json
{ "version": "0.1.0", "mcpEndpoint": "/mcp", "docs": "/docs" }
```

`mcpEndpoint` — путь MCP-сервера (те же операции по протоколу MCP, JSON-RPC,
та же Bearer-аутентификация); `docs` — путь Swagger UI.

## Рабочие пространства

### GET /v1/workspaces

Список пространств, в которых состоит владелец ключа. Без параметров.

Ответ:

```json
{
  "workspaces": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "name": "Команда продукта",
      "slug": "product",
      "role": "ADMIN",
      "isCurrent": false,
      "isDefault": true
    }
  ]
}
```

Поле `isCurrent` для REST-запросов всегда `false` (оно заполняется только для
MCP-вызовов с активным пространством).

### POST /v1/workspace/stats

Счётчики и состав пространства.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |

Ответ:

```json
{
  "members": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "firstName": "Анна",
      "lastName": "Иванова",
      "email": "anna@example.com",
      "role": "OWNER"
    }
  ],
  "pagesByType": { "TEXT": 42, "KANBAN": 3 },
  "totalPages": 45
}
```

### POST /v1/workspace/files

Список загруженных файлов пространства с пагинацией.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `limit` | number | нет | целое, 1–200, по умолчанию 50 |
| `offset` | number | нет | целое, ≥ 0, по умолчанию 0 |

Ответ:

```json
{
  "files": [
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "name": "report.pdf",
      "mimeType": "application/pdf",
      "size": 102400,
      "createdAt": "2026-06-01T10:00:00.000Z"
    }
  ]
}
```

### POST /v1/workspace/skills

Страницы-навыки (`ownership = SKILL`) пространства.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `limit` | number | нет | целое, 1–200, по умолчанию 50 |

Ответ:

```json
{
  "pages": [
    {
      "id": "44444444-4444-4444-4444-444444444444",
      "title": "Суммаризация встреч",
      "icon": null,
      "createdAt": "2026-05-20T08:30:00.000Z"
    }
  ]
}
```

### POST /v1/workspace/agents

Страницы-агенты (`ownership = AGENT`) пространства. Параметры и форма ответа —
те же, что у `/v1/workspace/skills`.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `limit` | number | нет | целое, 1–200, по умолчанию 50 |

### POST /v1/workspace/create-page-from-file

Создаёт страницу и прикрепляет к ней уже загруженный файл пространства.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `parentId` | string \| null | нет | UUID родительской страницы; по умолчанию корень |
| `fileId` | string | да | UUID файла из этого пространства |
| `title` | string | нет | 1–255 символов; по умолчанию имя файла |

Ответ:

```json
{ "pageId": "55555555-5555-5555-5555-555555555555" }
```

## Страницы

### POST /v1/pages/create

Создаёт страницу в пространстве.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `parentId` | string \| null | нет | UUID родительской страницы; по умолчанию корень |
| `title` | string | да | 1–255 символов |
| `ownership` | string | нет | `TEXT` \| `SKILL` \| `AGENT`, по умолчанию `TEXT` |
| `markdown` | string | нет | содержимое в Markdown, до 50000 символов |

Ответ:

```json
{
  "pageId": "55555555-5555-5555-5555-555555555555",
  "url": "/workspaces/11111111-1111-1111-1111-111111111111/pages/55555555-5555-5555-5555-555555555555"
}
```

Поле `url` возвращается в устаревшей форме `/workspaces/{workspaceId}/pages/{pageId}` —
такая ссылка продолжает работать и перенаправляет на канонический адрес `/pages/{pageId}`.

### POST /v1/pages/update

Меняет свойства или содержимое страницы.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `pageId` | string | да | UUID |
| `title` | string | нет | до 255 символов |
| `icon` | string \| null | нет | эмодзи-иконка; `null` убирает иконку |
| `content` | object | нет | JSON-документ содержимого (формат Tiptap/ProseMirror) |

Ответ:

```json
{ "ok": true }
```

### POST /v1/pages/move

Перемещает страницу к новому родителю и/или на новую позицию среди соседей.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `pageId` | string | да | UUID |
| `newParentId` | string \| null | нет | UUID нового родителя; `null` — корень |
| `prevPageId` | string \| null | нет | UUID страницы, после которой вставить; `null` — в начало |

Ответ:

```json
{ "ok": true }
```

### POST /v1/pages/markdown

Возвращает содержимое страницы как Markdown.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `pageId` | string | да | UUID |

Ответ:

```json
{ "markdown": "# Заголовок\n\nТекст страницы…" }
```

### POST /v1/pages/stats

Метаданные страницы: тип, назначение, автор, дата создания.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `pageId` | string | да | UUID |

Ответ:

```json
{
  "type": "TEXT",
  "ownership": "TEXT",
  "createdAt": "2026-05-20T08:30:00.000Z",
  "createdBy": {
    "id": "22222222-2222-2222-2222-222222222222",
    "firstName": "Анна",
    "lastName": "Иванова",
    "email": "anna@example.com"
  }
}
```

## Файлы страниц

### POST /v1/page-files/upload-file

Загружает небольшой файл на страницу через base64. Размер декодированного
содержимого — **не более 1 МБ (1048576 байт)**; превышение — ответ `413` с кодом
`FILE_TOO_LARGE`. Файлы крупнее загружайте через веб-приложение и прикрепляйте
по `fileId` через `/v1/page-files/attach-file`.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `pageId` | string | да | UUID |
| `fileName` | string | да | 1–512 символов |
| `mimeType` | string | да | 1–128 символов |
| `contentBase64` | string | да | base64-содержимое; после декодирования ≤ 1048576 байт |

Ответ:

```json
{ "fileId": "33333333-3333-3333-3333-333333333333" }
```

### POST /v1/page-files/upload-image

То же, что `upload-file` (включая лимит 1 МБ), но принимает только изображения:
`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`. Другой
`mimeType` — ответ `415` с кодом `UNSUPPORTED_MIME_TYPE`. Поля запроса и форма
ответа совпадают с `/v1/page-files/upload-file`.

### POST /v1/page-files/attach-file

Прикрепляет уже загруженный файл пространства к странице.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `pageId` | string | да | UUID |
| `fileId` | string | да | UUID файла из этого пространства |

Ответ:

```json
{ "ok": true }
```

### POST /v1/page-files/attach-image

То же, что `attach-file`, но файл должен быть изображением (список MIME-типов —
как у `upload-image`). Поля запроса и форма ответа совпадают с
`/v1/page-files/attach-file`.

### POST /v1/page-files/list

Список файлов, прикреплённых к странице.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `pageId` | string | да | UUID |

Ответ:

```json
{
  "files": [
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "name": "report.pdf",
      "mimeType": "application/pdf",
      "size": 102400,
      "createdAt": "2026-06-01T10:00:00.000Z"
    }
  ]
}
```

## Поиск

### POST /v1/search/pages

Поиск по страницам пространства: сначала полнотекстовый по названию и тексту,
затем семантический (если в пространстве настроена модель эмбеддингов).
Результаты объединяются без дублей.

| Поле | Тип | Обязательное | Ограничения |
| --- | --- | --- | --- |
| `workspaceId` | string | да | UUID |
| `query` | string | да | 1–500 символов |
| `k` | number | нет | целое, 1–20, по умолчанию 10 |

Ответ:

```json
{
  "results": [
    {
      "pageId": "55555555-5555-5555-5555-555555555555",
      "workspaceId": "11111111-1111-1111-1111-111111111111",
      "blockNumber": 0,
      "title": "План релиза",
      "content": "…фрагмент найденного текста…"
    }
  ]
}
```

## Примеры

### curl

```bash
curl -X POST https://api.anynote.ru/v1/pages/create \
  -H "Authorization: Bearer ank_ВАШ_КЛЮЧ" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "11111111-1111-1111-1111-111111111111",
    "title": "Заметки со встречи",
    "markdown": "# Итоги\n\n- решение раз\n- решение два"
  }'
```

### JavaScript (fetch)

```js
const BASE_URL = 'https://api.anynote.ru'
const API_KEY = process.env.ANYNOTE_API_KEY // ank_…

async function api(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // 401 — ключ: "Invalid API key" | "API key revoked" | "API key expired"
    // 400 — ошибка валидации; 403 — нет доступа к пространству;
    // 404 — объект не найден (например, PAGE_NOT_FOUND)
    const err = await res.json().catch(() => ({}))
    throw new Error(`AnyNote API ${res.status}: ${err.message ?? res.statusText}`)
  }
  return res.json()
}

const { results } = await api('/v1/search/pages', {
  workspaceId: '11111111-1111-1111-1111-111111111111',
  query: 'план релиза',
  k: 5,
})
```

## Swagger UI (self-hosted)

На сервере AnyNote Engines по пути `/docs` доступен интерактивный Swagger UI с
этим же набором эндпоинтов — удобно для исследования API на своей установке.
