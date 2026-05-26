# Page Ordering & Drag-and-Drop Design

**Date:** 2026-05-26  
**Scope:** Workspace pages sidebar — персонализированное избранное, сортировка, DnD, вставка в конец

---

## Требования

1. Добавление в избранное персонализировано для каждого пользователя (уже есть — `FavoritePage` per-user).
2. Порядок страниц в избранном персонализирован для каждого пользователя — каждый пользователь сам расставляет свои избранные.
3. Новая страница добавляется в конец списка братьев (root или дочерние), а не в начало как сейчас.
4. Перемещение страниц через drag & drop — поддерживает переупорядочивание среди братьев и смену родителя (вложенность).
5. Порядок страниц в основном дереве одинаков для всех пользователей воркспейса.

---

## Решения по дизайну

| Вопрос | Решение |
|--------|---------|
| DnD scope | Полное tree DnD: reorder siblings + смена родителя |
| Порядок избранного | Drag & drop внутри секции «Избранное», независимый от дерева |
| Права на DnD | Любой участник воркспейса (`assertWorkspaceMember`) |
| Drop indicator | Горизонтальная синяя линия между элементами (Notion-стиль), отступ = depth × 16px |
| DnD библиотека | `dnd-kit` (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) |

---

## Модель данных

### Дерево страниц — без изменений

Порядок хранится через linked list: `Page.prevPageId` (unique, nullable). Единый для воркспейса — одинаковый для всех пользователей. Существующий механизм `orderSiblings()` на клиенте читает этот список.

### Избранное — новое поле `position`

```prisma
model FavoritePage {
  id        String   @id @default(uuid())
  userId    String
  pageId    String
  position  Int      @default(0)   // новое: персональный порядок
  createdAt DateTime @default(now())
  // ...
  @@unique([userId, pageId])
}
```

Миграция для существующих записей:

```sql
UPDATE "FavoritePage" fp
SET position = sub.rn - 1
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "FavoritePage"
) sub
WHERE fp.id = sub.id;
```

### Вставка в конец при создании страницы

Сейчас `page.create` вставляет в начало (head) списка братьев: новая страница получает `prevPageId = null`, а первый существующий брат — `prevPageId = newPage.id`.

После фикса: найти последнего брата в той же группе `(parentId, workspaceId)` — того, чей `id` не встречается ни в одном `prevPageId` среди братьев (т.е. у которого нет следующей страницы). Установить `newPage.prevPageId = lastSibling.id`.

---

## Backend (tRPC)

### Новая процедура `page.reorder`

Используется DnD в дереве страниц. Не заменяет диалог `move` — он остаётся для ручного перемещения.

**Input:**
```ts
z.object({
  pageId: z.string().uuid(),
  newParentId: z.string().uuid().nullable(),
  newPrevPageId: z.string().uuid().nullable(),
})
```

**Логика (одна транзакция):**
1. Загрузить страницу по `pageId`, получить `page.workspaceId`
2. `assertWorkspaceMember(ctx, page.workspaceId)` — проверка прав
3. Проверить на цикл: `newParentId` не должен быть потомком `pageId`
4. Отцепить страницу из текущей позиции: найти следующего брата (тот, у кого `prevPageId = pageId`), установить ему `prevPageId = page.prevPageId`
5. Если `newParentId` изменился — обновить `page.parentId = newParentId`
6. Установить `page.prevPageId = newPrevPageId`
7. Найти страницу, которая стояла после `newPrevPageId` в той же группе братьев, и установить ей `prevPageId = pageId`
8. Enqueue outbox event `page.upserted`

**Permission:** `assertWorkspaceMember` (любой участник, в отличие от `move` который требует `assertPageOwnership`).

### Новая процедура `page.reorderFavorites`

**Input:**
```ts
z.object({
  workspaceId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
})
```

**Логика:** Обновить `position = index` для каждой записи `FavoritePage` текущего пользователя в одной транзакции. Игнорировать ID, которые не являются избранными текущего пользователя.

### Изменение `page.addFavorite`

При добавлении в избранное: `position = MAX(position) + 1` для текущего пользователя (добавить в конец избранного).

### Изменение `page.listFavorites`

Добавить `orderBy: { position: 'asc' }` в запрос.

### Изменение `page.create`

Заменить логику вставки в head на вставку в tail (см. «Вставка в конец» выше).

---

## Frontend

### Пакеты

```bash
pnpm --filter web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

`@hello-pangea/dnd` остаётся — только для Канбана, конфликта нет.

### Дерево страниц — `page-tree-section.tsx`

**Стратегия: flat list с depth.** Рекурсивное дерево конвертируется в плоский массив `FlatPageItem[]` перед рендером. dnd-kit работает с `SortableContext` по плоскому списку.

```ts
type FlatPageItem = PageItem & {
  depth: number
  collapsed: boolean
}
```

Функция `flattenTree(pages: PageItem[], collapsed: Set<string>): FlatPageItem[]` — рекурсивно обходит дерево с учётом свёрнутых узлов.

**Компоненты:**

- `<DndContext sensors={...} collisionDetection={closestCenter} onDragStart onDragEnd>` — корневой контекст. Sensors: PointerSensor с activation constraint `distance: 8` (чтобы не мешать кликам).
- `<SortableContext items={flatIds} strategy={verticalListSortingStrategy}>` — сортируемый список.
- `<SortablePageItem>` — обёртка над существующим `PageTreeItem`. Добавляет `useSortable` хук и drag-handle иконку (⠿) слева от заголовка страницы. Handle видим только при hover.
- `<DragOverlay>` — «призрак» перетаскиваемой страницы поверх сайдбара (полупрозрачный, без дочерних элементов).
- `<DropIndicator depth={n}>` — горизонтальная синяя линия (2px, `border-radius: 2px`, цвет `primary.main`) с отступом слева `depth × 16px`. Рендерится между двумя `SortablePageItem` в позиции вставки. Показывается только во время активного drag.

**`onDragEnd` логика:**

1. Определить `overId` (элемент под курсором) и целевую глубину по двум осям:
   - **Вертикаль** (позиция в зоне элемента): верхняя треть → вставить перед `overId`; нижняя треть → вставить после `overId`; средняя треть → вложить внутрь `overId`
   - **Горизонталь** (смещение курсора от левого края): при вставке «после» увеличенное горизонтальное смещение повышает глубину на 1 (страница становится последним дочерним у предыдущего брата). Это стандартная техника из примера dnd-kit sortable tree.
2. Вычислить `newParentId` и `newPrevPageId` из целевой позиции и глубины
3. Оптимистично обновить локальный `flatItems` (без мерцания)
4. Вызвать `trpc.page.reorder.mutate({ pageId, newParentId, newPrevPageId })`
5. При ошибке — откатить optimistic update, показать toast

**Drag handle:** виден только при `cursor: grab`, скрыт по умолчанию (`opacity: 0`, показывается при `hover` на строке). Клик на handle запускает drag, клик на остальной строке — навигация (без изменений).

**Права:** drag handle рендерится только если `workspaceMember !== null` (пользователь — участник воркспейса).

### Избранное — `favorites-section.tsx`

Плоский список — вложенности нет.

- `<DndContext onDragEnd>` + `<SortableContext items={favoriteIds}>`
- Каждый элемент оборачивается в `useSortable`, drag-handle слева (аналогично дереву)
- `onDragEnd`: оптимистичное обновление → `trpc.page.reorderFavorites.mutate({ workspaceId, orderedIds })`
- Drop indicator: та же `<DropIndicator depth={0}>`

---

## Тестирование

### Unit-тесты (Vitest, `packages/trpc/src/routers/page.test.ts`)

| Тест | Проверяет |
|------|-----------|
| `page.reorder` — reorder siblings | `prevPageId` обновляется корректно у страницы и соседей |
| `page.reorder` — смена родителя | `parentId` + linked list обоих родителей обновлены |
| `page.reorder` — вставка в начало (`newPrevPageId = null`) | Страница становится первой в группе |
| `page.reorder` — вставка в конец | Страница становится последней в группе |
| `page.reorder` — цикл запрещён | Ошибка при попытке вложить страницу в собственного потомка |
| `page.reorder` — права | Ошибка для не-участника воркспейса |
| `page.reorderFavorites` | `position` обновляется по индексу массива |
| `page.create` — вставка в конец | Новая страница имеет `prevPageId` = id последнего брата |
| `page.create` — первая страница | `prevPageId = null` если братьев нет |
| `page.listFavorites` — порядок | Возвращает в порядке `position ASC` |

### E2E (Playwright, `apps/e2e/page-ordering.spec.ts`)

| Тест | Сценарий |
|------|----------|
| Создание в конец | Создать 3 страницы → третья последняя в дереве |
| DnD reorder siblings | Перетащить страницу B выше A → новый порядок в сайдбаре после reload |
| DnD смена родителя | Перетащить страницу на середину другой → стала дочерней |
| Избранное DnD | Добавить 3 страницы в избранное, перетащить → порядок сохраняется после reload |
| Изоляция избранного | Два пользователя, у каждого свой порядок избранного |

> **Примечание:** yjs-сервер не запущен в Playwright. Порядок страниц хранится в Postgres через tRPC — reload-проверки корректны. Для DnD в E2E использовать `locator.dragTo(target, { targetPosition })` — стандартный Playwright API для симуляции перетаскивания.

---

## Затрагиваемые файлы

### Backend
| Файл | Изменение |
|------|-----------|
| `packages/db/prisma/schema.prisma` | `FavoritePage.position Int @default(0)` |
| `packages/db/prisma/migrations/` | Новая миграция + SQL для существующих записей |
| `packages/trpc/src/routers/page.ts` | `reorder`, `reorderFavorites` (новые), `create` (tail insert), `addFavorite` (position), `listFavorites` (order by position) |

### Frontend
| Файл | Изменение |
|------|-----------|
| `apps/web/package.json` | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `apps/web/src/components/workspace/page-tree-section.tsx` | DnD обёртки, flat list, SortablePageItem, DropIndicator, DragOverlay |
| `apps/web/src/components/workspace/favorites-section.tsx` | DnD обёртки, SortableFavoriteItem, DropIndicator |
| `apps/web/src/components/workspace/types.ts` | `FlatPageItem` тип, `flattenTree` функция |

### Тесты
| Файл | Изменение |
|------|-----------|
| `packages/trpc/src/routers/page.test.ts` | Новые unit-тесты (или создать если не существует) |
| `apps/e2e/page-ordering.spec.ts` | Новый E2E файл |
