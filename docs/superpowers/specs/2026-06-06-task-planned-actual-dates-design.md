# Kanban: плановая и фактическая даты задач — дизайн

**Дата:** 2026-06-06
**Статус:** утверждён (ожидает финального ревью спека)

## Контекст и проблема

Заказчику нужны два независимых поля дат на карточке задачи (и подзадачи) для
точного планирования и сбора фактических данных по срокам:

- **Плановая дата** — срок, к которому задача должна быть выполнена.
- **Фактическая дата** — дата, когда задача была выполнена по факту.

Цель — иметь возможность отследить **отклонение от плана** (Факт − План), которое
сейчас посчитать нельзя.

### Важная находка из кода (меняет постановку)

Вопреки исходной формулировке проблемы, в текущем коде **нет** автоматической
логики «дата выполнения = момент перевода в Готово». Перевод задачи в колонку с
видом `DONE` сейчас не проставляет никакую дату — пишется только запись
`STATUS_CHANGED` в журнал активности. Поля `completedAt` не существует.

При этом на модели `Task` **уже есть два поля дат**: `startDate` («Дата старта») и
`dueDate` («Срок»).

### Решения, принятые при брейнсторминге

1. **Соответствие полей (вариант A).** «Плановая дата» — это существующий
   `dueDate`. В коде/БД поле НЕ переименовываем (чтобы не трогать миграцией
   фильтры, Gantt, `board-card-model`, активность `DUE_DATE_CHANGED`); меняем
   только подпись в UI на «Плановая дата». `startDate` остаётся «Датой старта».
   Добавляем **одно** новое поле — `actualDate` («Фактическая дата»).

2. **Автозаполнение (мягкое, в домене).** При перетаскивании задачи в колонку
   вида `DONE`, **если `actualDate` пуста**, проставить текущую дату
   автоматически. Логика живёт в доменном слое (`KanbanService.moveTask`) — это
   единственный путь, через который задача попадает в «Готово».

3. **Триггер автоустановки — вид колонки `DONE`** (не конкретная колонка). Только
   `DONE`, не `CANCELLED`. Перемещение между двумя Done-колонками и возврат из
   «Готово» в работу **дату не трогают** (не ставят повторно, не стирают).

4. **Ручное управление.** Оба поля редактируемы вручную на любом этапе жизни
   задачи, независимо от статуса. Поле «Фактическая дата» можно очистить (вернуть
   в `null`) — для правок «задним числом». Рядом с пустым полем «Фактическая
   дата» в форме — кнопка «Указать сегодня».

5. **Гранулярность — дата без времени.** Автоустановка хранит полночь UTC
   (`startOfUtcDay`), единообразно с тем, как DatePicker отдаёт даты; «отклонение
   в днях» считается чисто.

6. **Журнал активности.** Новый тип события `ACTUAL_DATE_CHANGED` (по аналогии с
   `DUE_DATE_CHANGED` / `START_DATE_CHANGED`). Автоустановка помечается
   `payload.auto = true`, ручная правка — без флага.

7. **Подзадачи** (`children` через `parentId`) — обычные `Task`, поэтому оба поля
   и автоустановка работают для них точно так же. Никакой каскадной/агрегирующей
   логики.

8. **Отклонение** — храним поля **и** показываем вычисленное отклонение
   (Факт − План) в карточке доски и таблице.

## Соответствие полей: код ↔ UI

| Поле в БД/коде | Подпись в UI       | Назначение                            |
| -------------- | ------------------ | ------------------------------------- |
| `startDate`    | Дата старта        | без изменений                         |
| `dueDate`      | **Плановая дата**  | план/срок — переименована только подпись |
| `actualDate`   | **Фактическая дата** | новое поле                          |

> Семантический разрыв осознан и задокументирован: в БД поле зовётся `dueDate`,
> в UI — «Плановая дата». Переименование колонки затронуло бы ~10 файлов ради
> косметики, поэтому оставлено как есть.

## Архитектура

Поток данных следует существующему паттерну репозитория: вся запись — в
`@repo/domain`, потребляется `@repo/trpc` (и потенциально engines); UI — MUI
DatePicker через `@repo/ui/components`.

```
form/card (apps/web)
  → trpc task.update / task.move (passthrough, без изменений в роутере)
    → @repo/domain KanbanService.updateTask / moveTask  ← вся логика здесь
      → KanbanRepository (select/update actualDate)
        → Prisma Task.actualDate
```

## Секция 1 — модель данных (Prisma)

`packages/db/prisma/schema.prisma`:

- Новое поле на модели `Task` (рядом с `startDate`/`dueDate`):

  ```prisma
  actualDate  DateTime? @map("actual_date")
  ```

- Новое значение в enum `TaskActivityType`:

  ```prisma
  ACTUAL_DATE_CHANGED
  ```

- Миграция:
  `pnpm --filter @repo/db exec prisma migrate dev --name add_task_actual_date`.
  Поле nullable, добавление enum-значения — обратимо-совместимо; существующие
  задачи получают `actualDate = NULL`.

## Секция 2 — доменный слой (`@repo/domain`)

### 2.1 DTO (`packages/domain/src/kanban/dto/kanban.dto.ts`)

В `updateTaskInput` добавить поле через существующий хелпер `dateInput`
(принимает `Date | string | null | undefined`):

```typescript
actualDate: dateInput,
```

`createTaskInput` не трогаем — даты задаются через `updateTask`.

### 2.2 `updateTask` (`kanban.service.ts`, ~строки 119–155)

- Прокинуть `actualDate: input.actualDate` в `repo.updateTask`.
- По образцу `DUE_DATE_CHANGED` добавить запись активности при ручном изменении:

  ```typescript
  if (input.actualDate !== undefined && !sameDate(current.actualDate, input.actualDate))
    await this.repo.recordActivity({
      taskId: current.id, actorId: actorUserId,
      type: 'ACTUAL_DATE_CHANGED',
      payload: { from: toIso(current.actualDate), to: toIso(input.actualDate) },
    })
  ```

  Покрывает ручную установку, кнопку «Указать сегодня» и очистку (set null).

### 2.3 `moveTask` — автоустановка (`kanban.service.ts`, ~строки 157–198)

Внутри существующей транзакции `moveTask`, после записи `MOVED`/`STATUS_CHANGED`:

```typescript
if (toColumn.kind === 'DONE' && !current.actualDate) {
  const today = startOfUtcDay(new Date())
  await this.repo.updateTask(current.id, { actualDate: today, updatedById: actorUserId })
  await this.repo.recordActivity({
    taskId: current.id, actorId: actorUserId,
    type: 'ACTUAL_DATE_CHANGED',
    payload: { from: null, to: today.toISOString(), auto: true },
  })
}
```

Гарантии: срабатывает только при `kind === 'DONE'` и пустой `actualDate`; не
перезаписывает; перемещение между Done-колонками и возврат в работу дату не
трогают. `startOfUtcDay` — небольшой локальный хелпер (полночь UTC).

> `current` в `moveTask` берётся из `findTaskForMove`; нужно убедиться, что эта
> выборка возвращает `actualDate` (см. 2.4).

### 2.4 Репозиторий (`kanban.repository.ts`)

Добавить `actualDate` в:

- `update`-маппинг `updateTask`;
- `select`/возвращаемый тип в `findTaskForUpdate` и `findTaskForMove` (чтобы
  `current.actualDate` был доступен в сервисе);
- выборку задач для доски (если маппинг задачи в DTO живёт здесь — см. 3.3).

## Секция 3 — tRPC и типы фронтенда

### 3.1 tRPC роутер (`packages/trpc/src/routers/kanban/task.ts`)

Изменений в коде роутера **не требуется**: `update`/`move` уже принимают
`domain.updateTaskInput` / `domain.moveTaskInput` и делегируют в домен; realtime
`task.updated` уже эмитится.

### 3.2 Тип `BoardTaskData` (`apps/web/src/components/kanban/types.ts`)

```typescript
actualDate: DateInput // Date | string | null
```

### 3.3 Выборка доски

Убедиться, что процедура чтения доски (`boardQuery` / маппинг задачи в
`BoardTaskData`) включает `actualDate` в `select` и в возвращаемый объект.
Механический проброс поля параллельно с репозиторием (2.4).

## Секция 4 — UI формы задачи

`apps/web/src/components/kanban/task/task-form.tsx`. Сейчас popover `'dates'`
содержит два DatePicker'а внутри `<LocalizationProvider adapterLocale={dateFnsRu}>`.

### 4.1 Состояние и подпись

```typescript
const [actualDate, setActualDate] = useState<Date | null>(toDate(task.actualDate))
```

Подпись `dueDate`-пикера сменить со «Срок» на **«Плановая дата»**. «Дата старта»
без изменений.

### 4.2 Третий DatePicker + кнопка «Указать сегодня»

В том же popover, под «Плановой датой»:

```tsx
<Stack spacing={1}>
  <DatePicker
    label="Фактическая дата"
    value={actualDate}
    onChange={(value) => {
      setActualDate(value)
      updateTask.mutate({ pageId, id: task.id, actualDate: value })
    }}
    slotProps={{
      textField: { size: 'small', fullWidth: true },
      field: { clearable: true },
    }}
  />
  {!actualDate && (
    <Button size="small" variant="text" startIcon={<TodayIcon />}
      onClick={() => {
        const today = new Date()
        setActualDate(today)
        updateTask.mutate({ pageId, id: task.id, actualDate: today })
      }}>
      Указать сегодня
    </Button>
  )}
</Stack>
```

- Кнопка «Указать сегодня» видна только при пустом поле.
- `clearable` позволяет очистить фактическую дату (вернуть null).
- Поле редактируемо всегда, независимо от статуса.
- `TodayIcon` при необходимости до-экспортировать из `@repo/ui/components`
  (не импортировать из `@mui/material` напрямую — правило репозитория).

### 4.3 Отклонение в форме

Под полями дат: если заполнены и `dueDate`, и `actualDate`, показать строку
отклонения через общий хелпер (Секция 5): «Отклонение: +3 дня» / «в срок». Если
одно из полей пусто — ничего не показываем.

## Секция 5 — карточка, таблица и расчёт отклонения

### 5.1 Общий хелпер (новый файл `…/kanban/views/deviation.ts`)

```typescript
export interface Deviation { days: number; tone: 'onTime' | 'late' | 'early' }

// Факт − План в полных днях (по началу дня)
export function computeDeviation(due: Date | null, actual: Date | null): Deviation | null {
  if (!due || !actual) return null
  const days = Math.round((startOfDay(actual).getTime() - startOfDay(due).getTime()) / 86_400_000)
  return { days, tone: days > 0 ? 'late' : days < 0 ? 'early' : 'onTime' }
}

export function formatDeviation(d: Deviation): string {
  if (d.days === 0) return 'в срок'
  const n = Math.abs(d.days)
  const word = pluralizeDays(n) // день / дня / дней
  return d.days > 0 ? `+${n} ${word}` : `−${n} ${word}`
}
```

Знак: **Факт − План**; положительное = просрочка (`late`), отрицательное = раньше
(`early`), 0 = «в срок». Чистый хелпер → покрывается юнит-тестом (включая русскую
плюрализацию дней).

### 5.2 Карточка доски (`board-card-model.ts` + `board-card.tsx`)

- Существующий бейдж даты (`dueDate`, тон default/soon/overdue) сохраняется как
  «План».
- Если есть `actualDate` — рядом второй бейдж «Факт: 6 июн».
- Если заполнены оба — тон-окрашенное отклонение («+3 дня» красным / «в срок»
  зелёным / «−2 дня» зелёным).
- Когда задача закрыта фактически (есть `actualDate`), overdue-тон на плановой
  дате гасим.

### 5.3 Табличное представление (`table-view.tsx`)

Это спринт-/бэклог-список со строками (не grid с заголовками). В строки задач
добавить три значения: **«План»** (`dueDate`), **«Факт»** (`actualDate`),
**«Отклонение»** (вычисляемое, тон-окрашенное). Пустые поля — «—». Способ подачи
(шапка-легенда над строками либо подписи в ячейках) выбирается при реализации так,
чтобы минимально ломать текущую drag-and-drop-вёрстку.

## Секция 6 — фильтры и сортировка

### 6.1 Расширение `KanbanFilters` (`…/filters/apply-filters.ts`)

```typescript
actualFrom: string | null
actualTo: string | null
sortBy: 'manual' | 'planned' | 'actual' | 'deviation'
sortDir: 'asc' | 'desc'
```

`'manual'` — текущее поведение по умолчанию (без изменений).

### 6.2 Логика `applyFilters`

- После фильтра по `dueDate` добавить фильтр по `actualDate`
  (`actualFrom`…`actualTo`).
- Если `sortBy !== 'manual'`, применить стабильную сортировку: по `dueDate`, по
  `actualDate` или по `computeDeviation`. Задачи с пустыми полями — в конец.
- Сортировка применяется в табличном представлении; на доске — ручной порядок.

### 6.3 URL-параметры (`use-kanban-filters.ts`)

По образцу `from`/`to`/`overdue` добавить `afrom`/`ato`/`sort`/`dir`. Состояние
живёт в URL.

### 6.4 UI фильтров (`kanban-filters.tsx`)

Сейчас date-контролов в UI нет (структура поддерживает, UI нет). Добавить:

- два DatePicker'а «Факт с / Факт по»;
- контрол сортировки (Select: Вручную / Плановая / Фактическая / Отклонение +
  направление);
- заодно вывести существующий (но скрытый) фильтр по **плановой** дате
  (`dateFrom`/`dateTo`) — иначе асимметрично.

## Секция 7 — тестирование

### 7.1 Доменные тесты (`packages/domain`)

- `moveTask` → `DONE` при пустой `actualDate`: ставит сегодня + пишет
  `ACTUAL_DATE_CHANGED` с `auto:true`.
- `moveTask` → `DONE` при заполненной `actualDate`: НЕ перезаписывает, активность
  не пишется.
- `moveTask` между двумя Done-колонками: дату не трогает.
- `moveTask` возврат `DONE` → `ACTIVE`: `actualDate` сохраняется.
- `updateTask` с `actualDate` (ручная / очистка в null): пишет
  `ACTUAL_DATE_CHANGED` без `auto`.

### 7.2 tRPC тесты (`packages/trpc/test/kanban-task.test.ts`)

`update` с `actualDate` делегирует в `domainSvc.kanban.updateTask` с пробросом
поля.

### 7.3 Юнит-тесты хелпера (web, vitest)

`computeDeviation` (late/early/onTime, граничные дни); `formatDeviation` +
русская плюрализация (1 день / 2 дня / 5 дней / 11 дней).

### 7.4 Тест фильтров/сортировки (web)

`applyFilters` с `actualFrom`/`actualTo`; сортировка по
`planned`/`actual`/`deviation` (пустые поля в конец).

### E2E

Не добавляем: в Playwright нет yjs-сервера, тяжёлые kanban-сценарии флаки на
холодной компиляции (зафиксировано в памяти проекта). Полагаемся на пирамиду
юнит/интеграционных тестов выше.

### Гейты

Финально: `pnpm gates` (check-types + lint + build + test) для затронутых
пакетов (`@repo/db`, `@repo/domain`, `@repo/trpc`, `web`) + `pnpm
check-architecture`.

## Будущая аналитика (вне объёма этой итерации)

Поля `dueDate` (план) и `actualDate` (факт) хранятся в чистом виде, что
позволяет позднее посчитать метрику «Отклонение от плана» и сделать выгрузку
(CSV) без изменения модели данных. В этой итерации отклонение только
вычисляется и показывается в UI; выгрузка — отдельная задача.

## Сводка изменяемых файлов

| Файл | Изменение |
| ---- | --------- |
| `packages/db/prisma/schema.prisma` | поле `Task.actualDate` + enum `ACTUAL_DATE_CHANGED` + миграция |
| `packages/domain/src/kanban/dto/kanban.dto.ts` | `actualDate` в `updateTaskInput` |
| `packages/domain/src/kanban/services/kanban.service.ts` | `updateTask` (проброс + активность), `moveTask` (автоустановка) |
| `packages/domain/src/kanban/repositories/kanban.repository.ts` | `actualDate` в select/update/выборках |
| `apps/web/src/components/kanban/types.ts` | `actualDate` в `BoardTaskData` |
| board read query / маппинг | проброс `actualDate` в `BoardTaskData` |
| `apps/web/src/components/kanban/task/task-form.tsx` | подпись + третий DatePicker + «Указать сегодня» + отклонение |
| `apps/web/src/components/kanban/views/deviation.ts` (новый) | `computeDeviation` / `formatDeviation` / `pluralizeDays` |
| `apps/web/src/components/kanban/views/board-card-model.ts`, `board-card.tsx` | бейдж «Факт» + отклонение |
| `apps/web/src/components/kanban/views/table-view.tsx` | колонки План/Факт/Отклонение |
| `apps/web/src/components/kanban/filters/apply-filters.ts` | фильтр по факту + сортировка |
| `apps/web/src/components/kanban/use-kanban-filters.ts` | URL-параметры `afrom`/`ato`/`sort`/`dir` |
| `apps/web/src/components/kanban/kanban-filters.tsx` | UI: фильтры по плану/факту + сортировка |
| тесты (domain, trpc, web) | см. Секцию 7 |
