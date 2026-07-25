# Agent DATABASE Query Tooling — Design

**Status:** approved 2026-07-25  
**Scope:** read-only получение структуры и записей страницы типа `DATABASE` агентом, типизированные произвольные фильтры и проверочный сценарий подсчёта расходов.

## 1. Цель

Агент должен уметь:

1. определить структуру DATABASE-страницы до построения запроса;
2. понять, какие фильтры допустимы для каждого поля;
3. получить все доступные пользователю записи, подходящие под вложенный произвольный фильтр;
4. корректно работать с датами и денежными значениями;
5. посчитать общий расход на странице «Доходы и расходы» и вернуть сумму.

Тулинг остаётся read-only: создание DATABASE-страниц, колонок и записей агентом в эту итерацию не входит.

## 2. Утверждённые продуктовые правила

- Перед запросом записей агент вызывает `getDatabaseSchema`.
- Структура описывает каждое поле: идентификатор, имя, тип, формат значения, допустимые операторы и варианты значений для `SELECT`/`STATUS`.
- Если пользовательский запрос подразумевает период, но дата не названа, агент сначала просит указать период.
- Если пользователь отвечает «за всё время», «дата не важна», отказывается уточнять либо повторно не указывает дату, агент выполняет запрос без фильтра по дате.
- Отсутствие фильтра по дате означает все доступные строки DATABASE-источника, а не только строки активного представления.
- Произвольные фильтры поддерживают вложенные `and`, `or` и `not`.
- Поле в фильтре можно адресовать по `propertyId` или имени. После получения схемы агент должен предпочитать `propertyId`.
- MONEY передаётся агенту в недвусмысленном виде: целые копейки, десятичные рубли и валюта `RUB`.
- Инструменты соблюдают существующие права чтения DATABASE и row-level access. Недоступная строка никогда не попадает в ответ.
- Пагинация не должна молча обрезать результат. Пока присутствует `nextCursor`, агент продолжает чтение перед итоговым подсчётом.

## 3. Рассмотренные подходы

### 3.1 Расширить существующий DATABASE filter DSL — выбран

Новый MCP-слой разрешает имена полей, валидирует оператор относительно типа и компилирует запрос в общий domain DATABASE query path. Существующие права, вычисляемые поля и row-level access остаются единственным источником истины.

Преимущества:

- нет отдельной Prisma-реализации доступа;
- UI и агент используют одну семантику фильтров;
- типовые и вычисляемые значения возвращаются одинаково;
- фильтр можно развивать независимо от LLM-промпта.

### 3.2 Прямые Prisma-фильтры внутри MCP — отклонён

Этот вариант короче, но дублирует DATABASE query planner, вычисление FORMULA/ROLLUP/RELATION и row-level access. Риск расхождения прав и результатов неприемлем.

### 3.3 Свободная SQL-подобная строка — отклонён

Строка удобна человеку, но неоднозначна для дат, select-значений и MONEY, сложнее валидируется и создаёт ненужную поверхность безопасности. Естественный язык разбирает агент, а MCP получает структурированный фильтр.

## 4. Архитектура

Поток данных:

```text
пользователь
  → apps/agents: выяснить DATABASE pageId
  → anynote.getDatabaseSchema(pageId)
  → агент сопоставляет слова пользователя с propertyId/operator/value
  → при неоднозначном периоде агент задаёт один уточняющий вопрос
  → anynote.queryDatabaseRecords(pageId, filter, cursor)
  → apps/engines MCP
  → @repo/domain DatabaseService query path
  → DatabaseRepository + row-level access + computed cells
  → типизированные записи
  → агент читает все страницы, считает и отвечает
```

В `@repo/domain` появляется source-wide query path, который разделяет общую внутреннюю реализацию с существующим `listRows`. Существующая UI-семантика `listRows` не меняется: она по-прежнему учитывает настройки выбранного представления. MCP-запрос строит transient settings из переданных фильтров и сортировок и не зависит от persisted view.

`apps/engines` содержит:

- `DatabaseReadService` — вызывает domain, разрешает имена полей, валидирует фильтры и преобразует значения в агентный wire format;
- `DatabaseTools` — два `@Tool`-метода и Zod-схемы MCP;
- регистрацию сервисов в `McpModule`.

`apps/agents` содержит:

- read-only metadata для обоих инструментов с `pages:read` и без подтверждения;
- page-binding для аргумента `pageId`;
- системную инструкцию про обязательное чтение схемы, уточнение даты и полную пагинацию.

## 5. Инструмент `getDatabaseSchema`

### 5.1 Вход

```ts
interface GetDatabaseSchemaInput {
  workspaceId: string // автоматически подставляет MCP client
  pageId: string
}
```

### 5.2 Выход

```ts
interface AgentDatabaseSchema {
  page: {
    id: string
    title: string | null
  }
  sourceId: string
  fields: AgentDatabaseField[]
}

interface AgentDatabaseField {
  id: string
  name: string
  type: AgentDatabaseFieldType
  valueSchema: Record<string, unknown>
  filterOperators: AgentDatabaseFilterOperator[]
  options?: Array<{ id: string; name: string }>
}
```

В `fields` включается системное поле заголовка:

```json
{
  "id": "__title__",
  "name": "Название",
  "type": "TITLE",
  "valueSchema": { "type": "string" },
  "filterOperators": [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "is_empty",
    "is_not_empty"
  ]
}
```

Форматы значений:

- `TEXT`, `URL`, `EMAIL`, `PHONE`, `TITLE` → string;
- `NUMBER` → finite number;
- `MONEY` → `{ kopecks: integer, rubles: number, currency: "RUB" }`;
- `DATE` → ISO 8601 string;
- `CHECKBOX` → boolean;
- `SELECT`, `STATUS` → `{ id: string, name: string } | null`;
- `MULTI_SELECT` → массив `{ id, name }`;
- `PERSON`, `RELATION`, `PAGE_LINK`, `FILE` → типизированные массивы существующих безопасных read-моделей;
- вычисляемые поля возвращают вычисленное значение либо существующий `ComputedCellError`.

Для каждого типа `filterOperators` содержит только реально поддерживаемые операторы. Агент не должен угадывать их самостоятельно.

## 6. Инструмент `queryDatabaseRecords`

### 6.1 Вход

```ts
interface QueryDatabaseRecordsInput {
  workspaceId: string // автоматически подставляет MCP client
  pageId: string
  filter?: AgentDatabaseFilterGroup
  sorts?: AgentDatabaseSort[]
  cursor?: string
  limit?: number // 1..200, default 100
}

interface AgentDatabaseFilterGroup {
  conjunction: 'and' | 'or'
  conditions: Array<AgentDatabaseFilterCondition | AgentDatabaseFilterGroup | AgentDatabaseNotGroup>
}

interface AgentDatabaseNotGroup {
  not: AgentDatabaseFilterCondition | AgentDatabaseFilterGroup
}

interface AgentDatabaseFilterCondition {
  propertyId?: string
  propertyName?: string
  operator: AgentDatabaseFilterOperator
  value?: unknown
}

interface AgentDatabaseSort {
  propertyId?: string
  propertyName?: string
  direction: 'asc' | 'desc'
}
```

В каждом condition задаётся ровно один из `propertyId` и `propertyName`. Имя разрешается без учёта регистра, но только при единственном совпадении. Дублирующееся имя вызывает ошибку с перечислением подходящих `propertyId`.

### 6.2 Операторы

Универсальные:

- `equals`, `not_equals`;
- `is_empty`, `is_not_empty`.

Строковые:

- `contains`, `not_contains`;
- `starts_with`, `ends_with`.

Числовые и MONEY:

- `gt`, `gte`, `lt`, `lte`;
- `between`, `not_between`, где `value` — `{ min, max }`.

Дата:

- `before`, `after`, `on`;
- `on_or_before`, `on_or_after`;
- `between`, `not_between`, где `value` — `{ from, to }`.

Для дат `from` включительно, `to` исключительно. Агент передаёт ISO 8601 с явным timezone offset. Запрос «за июль 2026» преобразуется в `[2026-07-01T00:00:00+03:00, 2026-08-01T00:00:00+03:00)`.

Select/status и массивы:

- `is_any_of`, `is_none_of`;
- `contains_all` для multi-value полей.

Checkbox:

- `is_checked`, `is_not_checked`.

Оператор валидируется относительно типа поля. Например, `contains` для MONEY возвращает ошибку до обращения к репозиторию.

### 6.3 Выход

```ts
interface AgentDatabaseQueryResult {
  page: {
    id: string
    title: string | null
  }
  fields: AgentDatabaseField[]
  records: Array<{
    rowId: string
    pageId: string
    title: string | null
    values: Record<string, unknown> // ключ = propertyId
  }>
  nextCursor: string | null
}
```

Схема включается в каждый ответ, чтобы tool result оставался самодостаточным после пагинации. Значения keyed by стабильный `propertyId`; имена и типы берутся из `fields`.

## 7. Диалоговое правило даты

Уточнение делает агент, а не MCP-инструмент: инструмент не должен возвращать ошибку только из-за отсутствия date filter.

Алгоритм:

1. Если пользователь уже назвал дату, период или «за всё время», дополнительный вопрос не нужен.
2. Если запрос агрегирует записи и период не указан, агент спрашивает: «За какой период посчитать? Можно ответить “за всё время”.»
3. Если следующий ответ содержит период, агент формирует date condition.
4. Если следующий ответ не содержит периода, явно отказывается уточнять или выбирает «за всё время», агент вызывает tool без date condition.
5. Остальные фильтры сохраняются независимо от ответа о периоде.

## 8. Права и ошибки

- Оба инструмента используют `pages:read`, не требуют подтверждения и разрешены в page-bound chat только для привязанной страницы.
- Workspace membership, page visibility и DATABASE row-level access проверяются domain-слоем.
- Недоступная DATABASE-страница возвращается как not found, без раскрытия её существования.
- TEXT или другой не-DATABASE `pageId` возвращает `PAGE_IS_NOT_DATABASE`.
- Неизвестное поле возвращает `DATABASE_FIELD_NOT_FOUND`.
- Неоднозначное имя возвращает `DATABASE_FIELD_AMBIGUOUS` с безопасным списком `{ id, name, type }`.
- Несовместимый оператор возвращает `DATABASE_FILTER_OPERATOR_INVALID` и `allowedOperators`.
- Неверный формат значения возвращает `DATABASE_FILTER_VALUE_INVALID` с ожидаемым `valueSchema`.
- Неверная или timezone-less дата возвращает `DATABASE_DATE_INVALID`.
- Невалидный cursor возвращает существующую domain validation error.
- Никакая ошибка не подменяется пустым результатом.

## 9. Проверочный сценарий

Создать DATABASE-страницу «Доходы и расходы» с полями:

| Поле | Тип | Значения |
|---|---|---|
| Название | TITLE | описание операции |
| Тип | SELECT | `Доход`, `Расход` |
| Сумма | MONEY | сумма операции |
| Дата | DATE | дата операции |

Добавить записи:

| Название | Тип | Сумма | Дата |
|---|---:|---:|---:|
| Аренда | Расход | 30 000,00 ₽ | 2026-07-02 |
| Продукты | Расход | 8 450,50 ₽ | 2026-07-05 |
| Зарплата | Доход | 120 000,00 ₽ | 2026-07-10 |
| Транспорт | Расход | 1 549,50 ₽ | 2026-07-12 |

Промпт:

> На странице доходы и расходы просуммируй все суммы, которые были расписаны как расход и напиши сколько получился общий расход.

Ожидаемый первый ответ агента:

> За какой период посчитать? Можно ответить «за всё время».

Ответ пользователя:

> За всё время.

Ожидаемый tool flow:

1. `getDatabaseSchema(pageId)`;
2. определить `propertyId` полей «Тип» и «Сумма», а также option id «Расход»;
3. `queryDatabaseRecords` с `Тип is_any_of [expenseOptionId]`, без date condition;
4. дочитать все страницы до `nextCursor = null`;
5. сложить MONEY.rubles: `30000 + 8450.50 + 1549.50`.

Ожидаемый итоговый ответ:

> Общий расход: 40 000 ₽.

Доход `120 000 ₽` в сумму не входит.

## 10. Тестирование

### Domain

- source-wide query не применяет persisted view filter;
- nested `and`/`or`/`not`;
- все операторы по поддерживаемым типам;
- invalid operator/value;
- pagination после post-filter и row-access;
- вычисляемые поля и MONEY сохраняют точность.

### Engines

- `getDatabaseSchema` формирует операторы и value schema по типу;
- системное TITLE-поле присутствует;
- options select/status содержат id и name;
- name → id resolution, unknown и ambiguous names;
- `queryDatabaseRecords` компилирует фильтр и маппит typed wire values;
- оба tools проверяют workspace/page binding и domain errors;
- инструменты зарегистрированы в `McpModule`.

### Agents

- tools зарегистрированы как read-only `pages:read`;
- page-binding содержит `pageId`;
- executor prompt требует schema-first;
- запрос агрегата без периода вызывает уточнение;
- «за всё время» разрешает вызов без date filter;
- при `nextCursor` агент продолжает чтение.

### E2E

- создать DATABASE и четыре записи из §9;
- выполнить двухходовый диалог;
- проверить первый вопрос про период;
- ответить «За всё время»;
- проверить итог `40 000 ₽`;
- зафиксировать реальные tool calls: schema, filtered query и отсутствие date condition.

## 11. Критерии приёмки

1. Агент не читает DATABASE как пустой markdown.
2. До фильтрации агент знает тип каждого поля и допустимые операторы.
3. Произвольные вложенные фильтры валидируются и исполняются без прямого Prisma DSL от LLM.
4. Неуказанная дата приводит к одному уточняющему вопросу, но не блокирует запрос «за всё время».
5. Без date condition возвращаются все доступные строки источника.
6. Права DATABASE и row-level access не ослаблены.
7. MONEY суммируется без ошибки масштаба копейки/рубли.
8. Проверочный сценарий возвращает `40 000 ₽`.

## 12. Не входит в эту итерацию

- создание/изменение DATABASE-схемы и записей через MCP;
- сохранение фильтра как DATABASE view;
- серверный aggregation tool (`sum`, `avg`, `groupBy`);
- SQL или пользовательские скрипты в фильтрах;
- относительные даты как отдельный wire operator — агент переводит их в точный ISO-интервал;
- изменение UI таблицы.
