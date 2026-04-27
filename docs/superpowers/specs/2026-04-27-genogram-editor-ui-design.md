# Genogram Editor UI — Design

**Status:** Approved
**Date:** 2026-04-27
**Scope:** Расширение пакета `@repo/genogram` слоем редактирования: формы, контекстные меню, drawer-ы, начальный экран, авто-создание родителей, новые поля доменной модели, перетаскиваемая отметка развода, частичные даты.

## Mотивация и контекст

В монорепозитории уже существует пакет `packages/genogram/` с каркасом канваса (React Flow + Yjs): доменная модель Person/Union/ChildGroup/PregnancyLoss, рендер фигур, layout-алгоритм, CRUD-actions поверх Y.Doc. Однако UI-слой редактирования отсутствует: нет форм, контекстных меню, начального экрана, способа добавлять/связывать людей через UI. Эта спека описывает, что нужно добавить, чтобы пользователь мог построить семейную схему с нуля и редактировать её.

Прод-данных в Y.Doc/`Page.content` для страниц типа GENOGRAM сейчас нет — миграция данных не требуется.

## Решения, принятые в брейнсторминге

1. **Drawer справа** — все формы редактирования открываются в правой панели (MUI `Drawer anchor="right"`).
2. **Поповер-меню** — клик на элемент или линию связи показывает MUI `Menu` рядом с целью.
3. **Empty state с CTA** — при первом открытии пустой генограммы — карточка по центру с кнопкой "Создать генограмму".
4. **Возраст для "Жив"** — считается на дату создания генограммы (`meta.createdAt`), не на сегодня.
5. **Кириллица в крестах** — `А` (аборт) / `В` (выкидыш).
6. **Дефолтные родители при создании** — `identity.isUnknown=true`, `lifeStatus='unknown'`, союз `kind='marriage'` без дат, линия сплошная.
7. **Формат дат** — `15 апреля 2026` (родительный падеж месяца, без `г.`); поддержка частично заполненных дат.
8. **Валидация** — обязателен только пол.
9. **Read-only mode** — меню/drawer/CTA скрыты.
10. **Cancel** — без подтверждений; click outside drawer = cancel.
11. **`lifeStatus` тристейт** — `'alive' | 'deceased' | 'unknown'`. Удаляем legacy `isDeceased`.
12. **"Трагически"** — чекбокс при выборе "Умер"; X-маркер внутри элемента отображается при `tragically=true` ИЛИ `ageAtDeath<65`.
13. **Перетаскиваемая отметка развода** — `markPosition` 0..1 вдоль линии связи, default 0.5.
14. **Архитектурный подход A** — весь UI внутри `@repo/genogram`, MUI как dep (по аналогии с `@repo/excalidraw`).
15. **Партнёрская сторона при добавлении** — мужской партнёр слева от базы, женский справа (одиночный партнёр). При множественных партнёрах — слева направо по `partnerOrder` (старшинство).
16. **Поле "Укажите количество партнёров"** при `add-partner` — задаёт ordinal нового партнёра. Если итоговое total > 1, все партнёры базы получают ordinal'ы и число рисуется внутри их элемента.
17. **Поле "Порядковый номер партнёра"** в `edit-data` для партнёра — изменяет ordinal с авто-перенумерацией остальных и сменой позиции на схеме.
18. **Поле "Порядковый номер ребёнка"** в `edit-data` для ребёнка — изменяет позицию в `ChildGroup.children` (но число не рисуется внутри элемента).

## Архитектура и файловая структура

```
packages/genogram/
├── src/
│   ├── react-flow/
│   │   ├── GenogramBoard.tsx       (расширяется: оборачивает в DrawerHost + EmptyState)
│   │   └── GenogramFlow.tsx         (расширяется: useReducer для UI-state, обработка кликов на ноды/рёбра)
│   ├── ui/                          [новое]
│   │   ├── DrawerHost.tsx
│   │   ├── ElementMenu.tsx
│   │   ├── EdgeMenu.tsx
│   │   ├── EmptyState.tsx
│   │   └── ui-state.ts              (UiState reducer, types)
│   ├── forms/                       [новое]
│   │   ├── OwnerDataForm.tsx
│   │   ├── PersonDataForm.tsx
│   │   ├── MarriageRelationForm.tsx
│   │   ├── AddChildrenForm.tsx
│   │   ├── ChildEntryRow.tsx
│   │   ├── primitives/
│   │   │   ├── SexToggle.tsx
│   │   │   ├── LifeStatusToggle.tsx
│   │   │   ├── BirthDateOrAgeField.tsx
│   │   │   ├── PartialDateInput.tsx
│   │   │   └── ApproximateAgeInput.tsx
│   │   └── form-helpers.ts
│   ├── i18n/                        [новое]
│   │   ├── ru.ts                    (все строки UI на русском)
│   │   └── format-date.ts           (formatPartialDate)
│   ├── nodes/                       (расширяются)
│   │   ├── PersonNode.tsx           (X-маркер для tragically/<65, удаление inline "?", inner shape для role='owner')
│   │   ├── PregnancyLossNode.tsx    (Кириллица А/В)
│   │   ├── primitives/PersonLabel.tsx (новые правила позиционирования и содержимого)
│   │   └── OwnerCreationDateNode.tsx [новое]
│   ├── edges/
│   │   └── UnionLineEdge.tsx        (расширяется: перетаскиваемая отметка развода)
│   ├── yjs/
│   │   ├── schema.ts                (+ meta map)
│   │   └── actions.ts               (новые: createOwnerWithParents, addPartner, addParents, addChildren; расширены updatePerson/updateUnion)
│   ├── model/
│   │   ├── factories.ts             (createDefaultParent, createDefaultUnion)
│   │   └── computed.ts              (calcAge, shouldShowDeathCross, hasParents, …)
│   └── types/
│       └── domain.ts                (расширяется: PartialDate, LifeStatus, BirthMode, ApproximateAge, GenogramMeta, UnionDivorce.markPosition)
├── test/                            [новое]
│   ├── format-date.test.ts
│   ├── computed.test.ts
│   ├── actions.test.ts
│   ├── transforms.test.ts
│   ├── OwnerDataForm.test.tsx
│   ├── PersonDataForm.test.tsx
│   ├── MarriageRelationForm.test.tsx
│   ├── AddChildrenForm.test.tsx
│   ├── ElementMenu.test.tsx
│   └── EmptyState.test.tsx
└── jest.config.js                   [новое]
```

**Состояние UI** живёт в `GenogramFlow` через `useReducer<UiState, UiAction>`:

```ts
type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null

type DrawerState =
  | { mode: 'closed' }
  | { mode: 'create-genogram' }
  | { mode: 'edit-data'; personId: PersonId }
  | { mode: 'edit-owner-data'; personId: PersonId }
  | { mode: 'add-partner'; basePersonId: PersonId }
  | { mode: 'edit-connection'; unionId: UnionId }
  | { mode: 'add-children'; unionId: UnionId }

interface UiState {
  selection: Selection
  menu: { anchorEl: HTMLElement; kind: 'node' | 'edge'; targetId: string } | null
  drawer: DrawerState
}

type UiAction =
  | { type: 'select-node'; id: string; anchorEl: HTMLElement }
  | { type: 'select-edge'; id: string; anchorEl: HTMLElement }
  | { type: 'close-menu' }
  | { type: 'open-create' }
  | { type: 'open-drawer'; drawer: DrawerState }
  | { type: 'cancel' }
```

**Поток**: клик на узел → `select-node` → `Menu` показывается над узлом → клик на пункт → reducer закрывает menu и открывает drawer → форма читает `drawer` контекст, при сохранении вызывает Y.Doc action → reducer dispatch `cancel` (закрывает drawer).

**Новые зависимости** в `packages/genogram/package.json`:

```json
{
  "dependencies": {
    "@mui/material": "^7.3.10",
    "@mui/icons-material": "^7.3.10"
  }
}
```

`<PartialDateInput>` собирается из `<Select>` (день, месяц) + `<TextField type="number">` (год) без сторонних DatePicker компонентов — `@mui/x-date-pickers` не нужен.

## Доменная модель

```ts
// types/domain.ts (расширения)

export type LifeStatus = 'alive' | 'deceased' | 'unknown'
export type BirthMode  = 'date' | 'approximate'

export type ApproximateAge =
  | { kind: 'value'; value: number }                // "~42"
  | { kind: 'range'; from: number; to: number }     // "~30-35"

export interface PartialDate {
  year?: number      // 4-digit (e.g. 2026)
  month?: number     // 1-12
  day?: number       // 1-31
}

export interface LifeDates {
  birthDate?: PartialDate
  deathDate?: PartialDate
  birthMode: BirthMode               // default 'date'
  approximateAge?: ApproximateAge    // только если birthMode='approximate'
  lifeStatus: LifeStatus             // default 'unknown' для дефолтных родителей, 'alive' для владельца
  tragically?: boolean               // только если lifeStatus='deceased'
}

// Удаляем: isDeceased, deathKind, birthDateApprox, deathDateApprox

export interface UnionDivorce {
  date?: PartialDate
  custodySide?: 'male' | 'female' | 'shared'
  markPosition?: number              // 0..1; default 0.5
}

export interface GenogramMeta {
  createdAt: string                  // ISO timestamp; ставится один раз при "Создать генограмму"
  ownerId: PersonId
}
```

Аналогично, `Union.startDate`, `Union.endDate`, `PregnancyLoss.date` — теперь `PartialDate` (вместо `string`).

## UI-компоненты

### DrawerHost

MUI `<Drawer anchor="right" variant="persistent">`, ширина `360px`. Контент диспатчится по `drawer.mode`:

| `drawer.mode` | Заголовок | Содержимое |
|---|---|---|
| `closed` | — | drawer не виден |
| `create-genogram` | "Создание генограммы" | `<OwnerDataForm mode="create" />` |
| `edit-data` | "Редактирование данных" | `<PersonDataForm personId />` |
| `edit-owner-data` | "Данные владельца" | `<OwnerDataForm mode="edit" personId />` |
| `add-partner` | "Добавление партнёра" | `<PersonDataForm mode="create" partnerOf />` + `<MarriageRelationForm />` (одна форма, две графы; submit вызывает `addPartner` с обоими draft-ами) |
| `edit-connection` | "Редактирование связи" | `<MarriageRelationForm unionId />` |
| `add-children` | "Добавление детей" | `<AddChildrenForm unionId />` |

Кнопки в каждой форме: primary "Сохранить" (или "Создать" в create-режиме) справа + текстовая "Отменить" слева от primary. Click outside drawer dispatch'ит `cancel`. Никаких подтверждений несохранённых изменений.

### ElementMenu

MUI `<Menu>`, анкер передаётся через `event.currentTarget` из `ReactFlow.onNodeClick`.

| Тип узла | Условие | Пункты |
|---|---|---|
| `size='small'` | — | "Редактировать данные" |
| `size='big', role='regular'` | `hasParents=true` | "Редактировать данные", "Добавить партнёра" |
| `size='big', role='regular'` | `hasParents=false` | "Редактировать данные", "Добавить партнёра", "Добавить родителей" |
| `size='big', role='owner'` | — | "Редактировать данные владельца", "Добавить партнёра" |
| `PregnancyLoss` (крест) | — | "Редактировать данные" (мини-форма с выбором аборт/выкидыш и `<PartialDateInput>`) |

### EdgeMenu

MUI `<Menu>`, анкер из `ReactFlow.onEdgeClick`. Только для `UnionLineEdge`. Пункты: "Редактировать связь", "Добавить детей".

### EmptyState

Полноэкранная карточка по центру: иконка + "Генограмма пуста" + "Начните с заполнения данных владельца" + `<Button variant="contained">` "Создать генограмму". Рендерится когда `meta.createdAt` отсутствует. В readonly mode — только текст без кнопки.

## Каталог форм

### OwnerDataForm

| Поле | Компонент | Обязательно | Note |
|---|---|---|---|
| Фамилия | `<TextField>` | — | |
| Имя | `<TextField>` | — | |
| Отчество | `<TextField>` | — | |
| Пол | `<SexToggle>` (MUI `ToggleButtonGroup exclusive`) | ✅ | Мужской / Женский |
| Дата рождения | `<PartialDateInput>` | — | три отдельных Select/Input для day/month/year |

`mode="create"` (CTA "Создать генограмму"): primary кнопка "Создать генограмму". При submit вызывает `yjs.actions.createOwnerWithParents(draft)` → создаёт владельца + двух родителей + союз + пишет `meta`.

`mode="edit"` (Edit Owner Data): primary "Сохранить". Вызывает `yjs.actions.updatePerson(ownerId, patch)`. Смена пола меняет shape (квадрат↔круг), layout пересчитывает.

### PersonDataForm

| Поле | Компонент | Обязательно | Note |
|---|---|---|---|
| Фамилия | `<TextField>` | — | |
| Имя | `<TextField>` | — | |
| Отчество | `<TextField>` | — | |
| Пол | `<SexToggle>` | ✅ | |
| Тип возраста | `<ToggleButtonGroup>` | ✅ | "Дата рождения" / "Приблизительный возраст" |
| **Дата рождения** | `<PartialDateInput>` | — | если выбран "Дата рождения" |
| **Приблизительный возраст** | `<ApproximateAgeInput>` | — | если выбран "Приблизительный возраст"; внутри `<ToggleButtonGroup>` "Один возраст" / "Диапазон" → один `<TextField number>` либо два `<TextField number>` `from-to` |
| Жив/Умер/Неизвестно | `<LifeStatusToggle>` | ✅ | default `'unknown'` для добавляемых, `'alive'` для владельца |
| **Дата смерти** | `<PartialDateInput>` | — | если "Умер" |
| **Трагически** | `<Checkbox>` | — | если "Умер" |

**Условные поля по контексту**:

| Поле | Контекст показа | Компонент | Note |
|---|---|---|---|
| Укажите количество партнёров | mode='add-partner' (только) | `<TextField type="number" min={existingPartners + 1}>` | default = `existingPartners + 1`. Задаёт ordinal нового партнёра. Если задано >1, при submit все партнёры базы получают ordinal'ы 1..N. |
| Порядковый номер партнёра | mode='edit-data' AND person — партнёр базы с `>1` партнёрами у этой базы | `<TextField type="number" min={1} max={totalPartnersOfBase}>` | Изменение → реордер остальных с авто-перенумерацией. |
| Порядковый номер ребёнка | mode='edit-data' AND person — child в каком-либо ChildGroup | `<TextField type="number" min={1} max={siblingsCount}>` | Изменение → реордер `ChildGroup.children`. На схеме внутри элемента не рисуется. |

Используется в `edit-data`, `add-partner` (как блок), child entries в `add-children`.

### MarriageRelationForm

| Поле | Компонент | Обязательно | Note |
|---|---|---|---|
| Брак / Отношения | `<ToggleButtonGroup>` | ✅ | default `'marriage'` |
| **Дата свадьбы** | `<PartialDateInput>` | — | если "Брак" |
| **Брак расторгнут** | `<Checkbox>` | — | если "Брак" |
| **Дата развода** | `<PartialDateInput>` | — | если "Брак расторгнут" |
| **Дата начала отношений** | `<PartialDateInput>` | — | если "Отношения" |
| **Отношения закончены** | `<Checkbox>` | — | если "Отношения" |
| **Дата завершения** | `<PartialDateInput>` | — | если "Отношения закончены" |

Используется в `add-partner` (после Person fields), `edit-connection`.

Mapping в Union:
- "Брак" → `kind='marriage'`, `startDate=<дата свадьбы>`, `divorce={date,markPosition}` если расторгнут
- "Отношения" → `kind='cohabitation'`, `startDate=<дата начала>`, `endDate=<дата завершения>` если закончены

### AddChildrenForm

```
Укажите количество детей: [<NumberInput min=1>]
─────────────────────────────────────────
[≡] 1. <ChildEntryRow data="существующий ребёнок"  collapsed-readonly-fio>
    2. <ChildEntryRow new>
    3. <ChildEntryRow new>
   …
[Сохранить] [Отменить]
```

- Если у пары нет детей → все строки пустые `ChildEntryRow`.
- Если у пары `K>0` существующих детей → первые K строк заняты ими (drag-handle для перестановки), остальные `count - K` пустые.
- `<NumberInput min={K} />` — нельзя установить количество меньше существующих (удаление детей — отдельный flow, вне scope).
- Default value `<NumberInput>` при открытии формы: `K + 1` (если K=0, то 1).
- Drag-handle перетаскивает строку выше/ниже среди других.

При submit:
1. Если порядок существующих детей изменён — `updateChildGroup(childGroupId, { children: <new-order> })`.
2. Для каждой новой строки — `addChildren(unionId, [...new entries])`.

### ChildEntryRow

| Поле | Компонент | Note |
|---|---|---|
| Тип | `<ToggleButtonGroup>` | "Ребёнок" / "Выкидыш" / "Аборт"; default "Ребёнок" |
| **Если "Ребёнок"** | inline collapsed `<PersonDataForm>` | вложено |
| **Если "Выкидыш" или "Аборт"** | `<PartialDateInput>` "Дата" | вложено |

Mapping:
- "Ребёнок" → `addPerson(size='small')` + entry `{kind:'person', personId}`
- "Выкидыш" → `addPregnancyLoss(kind='miscarriage')` + entry `{kind:'loss', lossId}`
- "Аборт" → `addPregnancyLoss(kind='abortion')` + entry `{kind:'loss', lossId}`

## Визуализация

### Подписи (правила позиционирования)

- **Большие** (`size='big'`): подпись справа, `gap=12px`, выравнивание по вертикальному центру.
- **Маленькие** (`size='small'`): подпись снизу, `gap=8px`, выравнивание по горизонтальному центру.
- **PregnancyLoss**: подпись снизу, `gap=6px`.

Поле `Person.label.position` удаляется из доменной модели — позиция всегда вычисляется из `size`.

### Содержимое подписи

Строка 1: ФИО (если хоть одно из firstName/lastName/middleName заполнено) либо `Неизвестный` / `Неизвестная` (если `identity.isUnknown=true`). Если `lifeStatus='unknown'` — справа добавляется `?`.
Строка 2: возраст. См. правила в "Расчёт возраста".
Строка 3: дата рождения (если задана и `birthMode='date'`).
Строка 4: для `lifeStatus='deceased'` — `† <дата смерти>` (если `deathDate` задана).

Скрываем подпись целиком, если все строки пустые.

### Дата создания генограммы

Отдельный неперемещаемый, невыбираемый React Flow node `OwnerCreationDateNode` с фиксированной позицией `{ x: ownerNode.x + 280, y: ownerNode.y }`. Текст: `Дата создания: 15 апреля 2026` (через `formatPartialDate({day,month,year})` для `meta.createdAt`). Цвет `text.secondary`, `font-size=12px`.

### Формы элементов (PersonNode)

| Состояние | Реализация |
|---|---|
| Большой квадрат | `<rect width=80 height=80>` (sex='male', size='big', role='regular') |
| Большой круг | `<circle r=40>` (sex='female', size='big', role='regular') |
| Большой квадрат с квадратом внутри | `sex='male', role='owner'` — внешний `<rect 80>` + внутренний `<rect 50>` (концентрический) |
| Большой круг с кругом внутри | `sex='female', role='owner'` — внешний `<circle r=40>` + внутренний `<circle r=24>` |
| Маленький квадрат | `<rect width=48 height=48>` (sex='male', size='small') |
| Маленький круг | `<circle r=24>` (sex='female', size='small') |
| **X-маркер "Умер" (поверх)** | если `lifeStatus='deceased' && (tragically OR ageAtDeath<65)`: для квадрата — две диагонали из углов; для круга — две диагонали, **вписанные** в круг (концы на `r·cos45°` от центра) |
| **Номер партнёра внутри элемента** | если у базы (партнёр которого данная Person) `totalPartnersOfBase > 1` И у Person задан `partnerOrder` — отрисовываем число `partnerOrder` в центре элемента, `font-size=18px`, `text-anchor='middle'`. Не пересекается с X-маркером (если "Умер" + tragically — число рисуется поверх линий, чуть выше центра). Внутри inner-shape владельца число не рисуется (владелец сам не партнёр). |

Удаляется: inline `?` внутри элемента (теперь `?` идёт в подпись), legacy X-маркер для `deathKind`.

### PregnancyLoss (крест)

- Размер `24×24`, две диагональные линии (X), `stroke-width=2`.
- Буква в правом верхнем углу: `А` (kind='abortion') / `В` (kind='miscarriage'), кириллица, `font-size=10px`.
- Подпись снизу: дата (через `formatPartialDate`).

### Линии связи (UnionLineEdge)

| Союз | Стиль |
|---|---|
| `kind='marriage'` (включая дефолт от `addParents` / `createOwnerWithParents`) | сплошная, `stroke-width=2`, `stroke=text.primary` |
| `kind='cohabitation'` | штриховая, `stroke-dasharray='6 4'`, `stroke-width=2` |

При наличии `union.divorce`: маркер развода — два коротких диагональных штриха `//`, длина ~14px, наклон 60°, `stroke-width=2`. Позиция вдоль линии: `pos = divorce.markPosition ?? 0.5`. Координаты:

```
markX = x1 + (x2 - x1) * pos
markY = y1 + (y2 - y1) * pos
```

Маркер обёрнут в `<g>` с `cursor: grab` (hover) / `grabbing` (drag), хитбокс — невидимый `<rect 24×24>` вокруг штрихов.

**Drag-логика**:
- `onMouseDown` → `event.stopPropagation()` (чтобы не панорамировать канвас), фиксируем `dragStart={mouseX, mouseY}`, `posStart=currentPos`.
- `onMouseMove` (window-level listener) → проекция смещения мыши на направление линии: `deltaScalar = (mouseDx*ux + mouseDy*uy) / lineLength`, `localPos = clamp(posStart + deltaScalar, 0, 1)`. Только локальный state, без записи в Y.Doc.
- `onMouseUp` → один раз пишем `yjs.actions.updateUnion(unionId, { divorce: { ...divorce, markPosition: localPos } })`, очищаем listeners, end drag.

Линия от родителей к детям (`ChildEdge`): всегда сплошная, без изменений.

## Y.Doc actions

Все операции обёрнуты в `doc.transact()`.

```ts
// yjs/actions.ts (новые)

createOwnerWithParents(doc, draft: OwnerDataDraft): {
  ownerId: PersonId
  fatherId: PersonId
  motherId: PersonId
  unionId: UnionId
  childGroupId: ChildGroupId
}

addPartner(
  doc,
  basePersonId: PersonId,
  personDraft: PersonDataDraft,
  unionDraft: UnionDraft,
  newPartnerOrder: number,    // = "Укажите количество партнёров"; если 1 — partnerOrder не выставляется
): {
  partnerId: PersonId
  unionId: UnionId
}
// Side effect: если newPartnerOrder > 1 (у базы будет >1 партнёров после добавления) —
// существующие партнёры базы получают partnerOrder 1..K, новый партнёр получает newPartnerOrder.
// Если newPartnerOrder ≤ existing K — новые ordinal'ы вставляются со смещением остальных.

setPartnerOrder(doc, partnerId: PersonId, newOrder: number): void
// При edit-data → "Порядковый номер партнёра". Реордерит партнёров базы:
// все остальные партнёры с ordinal ≥ newOrder сдвигаются на +1 (или -1 в зависимости от направления).
// Гарантирует уникальность ordinal'ов 1..N.

setChildOrder(doc, childPersonId: PersonId, newOrder: number): void
// При edit-data → "Порядковый номер ребёнка". Реордерит ChildGroup.children, к которому принадлежит ребёнок.
// Если ребёнок входит в несколько ChildGroup (что не предполагается доменом) — операция throws.

addParents(doc, childPersonId: PersonId): {
  fatherId: PersonId
  motherId: PersonId
  unionId: UnionId
  childGroupId: ChildGroupId
}
// Pre: hasParents(childPersonId)===false. UI скрывает пункт меню в этом случае; действие throws assertion если нарушено.

addChildren(
  doc,
  unionId: UnionId,
  newEntries: ChildEntryDraft[],
  reorderExisting?: ChildEntry[],
): void
// reorderExisting заменяет полный children список существующих детей в новом порядке;
// newEntries добавляются в конец после существующих.

updateUnion(doc, unionId, patch: Partial<Union>): void
// Расширяется поддержкой: kind, startDate, endDate, divorce.

updatePerson(doc, personId, patch: Partial<Person>): void
// Расширяется поддержкой: lifeStatus, tragically, birthMode, approximateAge, partial dates.
```

### Метаданные

```ts
// yjs/schema.ts (расширение)
// Y.Map<string> с известными ключами 'createdAt' и 'ownerId';
// 'ownerId' хранится как string (PersonId — branded string).
genogram.meta → Y.Map<string>

// yjs/actions.ts
getMeta(doc): GenogramMeta | null
// Возвращает null если meta.get('createdAt') отсутствует → EmptyState показывается.
setMeta(doc, meta: GenogramMeta): void
// Записывает createdAt и ownerId в meta map. Вызывается один раз — внутри createOwnerWithParents.
```

### Computed helpers

```ts
// model/computed.ts (расширения)
hasParents(personId: PersonId, childGroups: Record<ChildGroupId, ChildGroup>): boolean
getChildGroupOf(personId, childGroups): ChildGroup | null
getChildrenOf(unionId, childGroups, peopleMap): ChildEntry[]
calcAge(birthDate: PartialDate, refDate: PartialDate | string): number | undefined
calcAgeAtDeath(person: Person): number | undefined
shouldShowDeathCross(person: Person): boolean   // tragically || ageAtDeath<65
formatPartialDate(date: PartialDate): string    // в i18n/format-date.ts

// Партнёрские helpers
getBaseOf(partnerId, unions): PersonId | null
// Возвращает противоположную сторону Union'а, в котором partnerId участвует.
// Если у partnerId несколько Union'ов — это сам "central" person, возвращает null.

getPartnersOf(basePersonId, unions): { unionId, partnerId, partnerOrder? }[]
// Все партнёры базы, отсортированные по partnerOrder ascending (без ordinal — в конец).

countPartnersOf(basePersonId, unions): number
// Длина getPartnersOf.

shouldShowPartnerOrder(personId, people, unions): boolean
// true если Person — партнёр базы с >1 партнёрами. Используется в PersonNode для рендера числа.
```

## Layout: размещение партнёров и детей

### Партнёры

Применяется в `layout/placement.ts` при расчёте позиций партнёров базы.

| Случай | Правило |
|---|---|
| База имеет 1 партнёра | Если новый партнёр `sex='male'` — слева от базы; `sex='female'` — справа от базы. (При редактировании пола одиночного партнёра — он "переезжает" на соответствующую сторону.) |
| База имеет 2+ партнёров | Все партнёры размещаются на одной горизонтальной линии с базой, упорядоченные по `partnerOrder` слева направо (1 — самый левый). База располагается в середине, между партнёром с самым низким `partnerOrder` и следующим. Если партнёров чётное число, база между двумя средними. (Точное расположение остаётся за алгоритмом placement; правило задаёт порядок.) Sex-правило в этом случае не применяется. |

Y-координата партнёров — та же, что у базы (одна линия иерархии).

### Дети

| Случай | Правило |
|---|---|
| Один ребёнок | Размещается под родительской линией связи (центрировано относительно союза). |
| Несколько детей | Размещаются на одной горизонтальной линии под родительской линией связи, в порядке `ChildGroup.children`. Левый край = первый элемент массива, правый = последний. |

`partnerOrder` хранится в существующем поле `Person.partnerOrder` (тип уже определён в модели). Контракт:
- Поле обязательно для всех партнёров базы, у которой `>1` партнёров.
- Поле undefined, если у базы `≤1` партнёр.
- Управляется только через actions `addPartner` и `setPartnerOrder` (никаких прямых правок). Actions гарантируют консистентность ordinal'ов 1..N.

## Расчёт возраста

| Что есть | Возраст |
|---|---|
| `birthDate {day,month,year}` + `lifeStatus='alive'` | exact: `floor((meta.createdAt − birthDate)/365.25)` |
| `birthDate {day,month,year}` + `lifeStatus='deceased'` + `deathDate {day,month,year}` | exact: `floor((deathDate − birthDate)/365.25)` |
| `birthDate {day,month,year}` + `lifeStatus='unknown'` | exact на `meta.createdAt` |
| `birthDate {year}` only | approximate: `meta.createdAt.year − birthDate.year` |
| `birthDate` без года | возраст не показываем |
| `birthMode='approximate'` | отображаем `approximateAge` как введено: `~42 года` или `~30-35` |

`ageAtDeath` (для проверки `<65` → X-маркер) вычисляется только если есть года в обоих `birthDate` и `deathDate`. Если данных мало — `tragically` остаётся независимым флагом, X-маркер ставится только по чекбоксу.

## Форматирование дат

`formatPartialDate(d: PartialDate): string` в `i18n/format-date.ts`:

| `d` | Вывод |
|---|---|
| `{day:15, month:4, year:2026}` | `15 апреля 2026` (родительный) |
| `{month:4, year:2026}` | `апрель 2026` (именительный) |
| `{year:2026}` | `2026` |
| `{day:15, month:4}` (без года) | `15 апреля` |
| `{day:15}` или `{month:4}` (без года и одного из) | `''` (пусто) |
| `{}` (пусто) | `''` |

## i18n

Все user-facing строки в `i18n/ru.ts` (плоский namespace, `RU.<screen>.<key>`):

```ts
export const RU = {
  emptyState: {
    title: 'Генограмма пуста',
    subtitle: 'Начните с заполнения данных владельца',
    cta: 'Создать генограмму',
  },
  drawer: {
    titleCreate: 'Создание генограммы',
    titleEditData: 'Редактирование данных',
    titleEditOwner: 'Данные владельца',
    titleAddPartner: 'Добавление партнёра',
    titleEditConnection: 'Редактирование связи',
    titleAddChildren: 'Добавление детей',
    save: 'Сохранить',
    create: 'Создать генограмму',
    cancel: 'Отменить',
  },
  fields: {
    lastName: 'Фамилия',
    firstName: 'Имя',
    middleName: 'Отчество',
    sex: 'Пол',
    sexMale: 'Мужской',
    sexFemale: 'Женский',
    birthDate: 'Дата рождения',
    approximateAge: 'Приблизительный возраст',
    lifeStatus: 'Статус',
    alive: 'Жив',
    deceased: 'Умер',
    unknown: 'Неизвестно',
    deathDate: 'Дата смерти',
    tragically: 'Трагически',
    relationKind: 'Тип',
    marriage: 'Брак',
    cohabitation: 'Отношения',
    weddingDate: 'Дата свадьбы',
    divorced: 'Брак расторгнут',
    divorceDate: 'Дата развода',
    relationStartDate: 'Дата начала',
    relationEnded: 'Отношения закончены',
    relationEndDate: 'Дата завершения',
    childCount: 'Укажите количество детей',
    childKind: 'Тип',
    childKindChild: 'Ребёнок',
    childKindMiscarriage: 'Выкидыш',
    childKindAbortion: 'Аборт',
    eventDate: 'Дата',
    ageMode: 'Тип возраста',
    ageModeSingle: 'Один возраст',
    ageModeRange: 'Диапазон',
    ageFrom: 'От',
    ageTo: 'До',
    partnerCount: 'Укажите количество партнёров',
    partnerOrder: 'Порядковый номер партнёра',
    childOrder: 'Порядковый номер ребёнка',
  },
  menu: {
    editData: 'Редактировать данные',
    editOwnerData: 'Редактировать данные владельца',
    addPartner: 'Добавить партнёра',
    addParents: 'Добавить родителей',
    editConnection: 'Редактировать связь',
    addChildren: 'Добавить детей',
  },
  labels: {
    creationDate: 'Дата создания',
    unknownPerson: { male: 'Неизвестный', female: 'Неизвестная' },
    // Склонение по русским правилам: 1 год / 2-4 года / 5-20 лет, далее по последней цифре
    yearsSuffix: (n: number): 'год' | 'года' | 'лет' => {
      const mod10 = n % 10
      const mod100 = n % 100
      if (mod10 === 1 && mod100 !== 11) return 'год'
      if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'года'
      return 'лет'
    },
    yearsOld: (n: number) => `${n} ${RU.labels.yearsSuffix(n)}`,
    yearsOldApprox: (n: number) => `~${n} ${RU.labels.yearsSuffix(n)}`,
    yearsOldRange: (from: number, to: number) => `~${from}-${to}`,
  },
  months: {
    nominative: ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'],
    genitive:   ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'],
  },
}
```

## Тестовая стратегия

### Unit (Jest)

`packages/genogram/test/`, конфиг по аналогии с `packages/yookassa/jest.config.js`.

- `format-date.test.ts` — все ветки `formatPartialDate`.
- `computed.test.ts` — `calcAge`, `calcAgeAtDeath`, `shouldShowDeathCross`, `hasParents`, `getChildGroupOf`.
- `actions.test.ts` — Y.Doc actions: `createOwnerWithParents` создаёт правильный набор; `addParents` блокируется (assertion) если родители уже есть; `addChildren` корректно вставляет реордер + новых детей; `addPartner` создаёт союз правильного kind; `addPartner` с `newPartnerOrder>1` авто-нумерует существующих партнёров; `setPartnerOrder` реордерит без дыр; `setChildOrder` меняет позицию в `ChildGroup.children`; `updateUnion` поддерживает `divorce.markPosition`.
- `placement.test.ts` — single male партнёр слева, single female справа; multi-partner упорядочены по `partnerOrder`; дети по порядку `ChildGroup.children`.
- `transforms.test.ts` — round-trip domain ↔ page snapshot не теряет новые поля.

### Component (Jest + RTL)

- `OwnerDataForm.test.tsx` — submit вызывает action с правильным draft; режим `create` vs `edit`.
- `PersonDataForm.test.tsx` — все переключатели (birthMode, lifeStatus); поля даты смерти + tragically появляются по условию; диапазон возраста; "Укажите количество партнёров" видно только в `add-partner`; "Порядковый номер партнёра" виден только при редактировании партнёра базы с >1 партнёрами; "Порядковый номер ребёнка" виден только при редактировании ребёнка.
- `MarriageRelationForm.test.tsx` — Брак/Отношения переключение, расторгнут/закончены.
- `AddChildrenForm.test.tsx` — динамическое количество строк; существующие дети первыми; перетаскивание меняет порядок; submit.
- `ElementMenu.test.tsx` — пункты по типу узла; "Добавить родителей" скрыт если родители уже есть.
- `EmptyState.test.tsx` — CTA в editor mode, скрыт в readonly.

### E2E (Playwright)

`apps/e2e/genogram.spec.ts` с четырьмя сценариями:

1. **Создание генограммы**: GENOGRAM page → empty state → "Создать" → форма владельца → submit → 3 элемента (владелец с inner shape + 2 родителя), сплошная линия, дата создания справа от владельца.
2. **Add partner + edit connection**: владелец → "Добавить партнёра" → форма + "Брак" → submit → партнёр с линией. Клик на линию → "Редактировать связь" → переключение на "Отношения" → линия штриховая.
3. **Add children + edit data + tragically**: на линии → "Добавить детей" count=2, "Ребёнок" + "Выкидыш" → 2 маленьких + крест с буквой В. Клик на ребёнка → "Редактировать" → "Умер" + "Трагически" → внутри ребёнка X.
4. **Drag divorce mark persistence**: брак с разводом → перетащить отметку → reload → отметка в новой позиции.
5. **Multi-partner ordering**: владелец → "Добавить партнёра" #1 (count=1) → партнёр без числа внутри. Добавить партнёра #2 (count=2) → у обоих партнёров появляется ordinal внутри (1 и 2), они упорядочены слева направо. Edit partner #1 → "Порядковый номер партнёра" → меняем на 2 → партнёр #2 становится #1, перемещаются местами на схеме.

Зависит от dev-сервера на `localhost:3000` (см. CLAUDE.md), использует существующую auth-фикстуру.

## Миграция

Прод-данных нет (подтверждено). Не пишем миграцию `migrateV1toV2`. Изменения типов вносим напрямую: новый формат сразу пишется как `version: 1`. Существующая `transforms/migrate.ts` остаётся как точка расширения для будущих миграций.

## Изменения в смежных файлах

- `apps/web/src/components/page/page-renderer.tsx`: без изменений (рендер `GenogramBoard` уже подключен).
- `packages/db/prisma/schema.prisma`: без изменений (всё в Y.Doc/JSON snapshot).
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`: без изменений (`isFullBleed` уже включает GENOGRAM).
- `packages/trpc`: без изменений.

## Out of scope

- Удаление существующих детей через UI (только реордер и добавление; удаление — отдельный flow).
- Глубокая иерархия (3+ поколения по линии) — layout алгоритм существует и работает, но не тестируется в этой итерации сверх E2E "сценарий 3".
- Annotations (жёлтые плашки) — не затрагиваем.
- Экспорт/печать генограммы.
- Уровень "BirthGroup" (близнецы) — сохраняется в модели, но в формах не редактируется в этой итерации.
- Профиль человека (характер, профессия, болезни — поля в `PersonProfile`) — не редактируется; оставляем модель, но без UI.
