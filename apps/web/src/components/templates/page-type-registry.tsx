'use client'

import {
  AccountTreeIcon,
  BrushIcon,
  DashboardIcon,
  DescriptionIcon,
  MicIcon,
  SchemaIcon,
  StorageIcon,
  ViewKanbanIcon,
} from '@repo/ui/components'
import type { PageType } from '@repo/db'

/** All the page-type icons share MUI's SvgIcon component shape. */
type IconComponent = typeof DescriptionIcon

/**
 * The subset of PageType that the UI lets users create from scratch. FORM exists
 * in the Prisma enum but has no editor yet, so it is intentionally excluded —
 * keep this in sync with the page renderer's support.
 */
export type CreatablePageType = Extract<
  PageType,
  | 'TEXT'
  | 'EXCALIDRAW'
  | 'GENOGRAM'
  | 'MERMAID'
  | 'PLANTUML'
  | 'LIKEC4'
  | 'DRAWIO'
  | 'KANBAN'
  | 'DATABASE'
>

export interface PageTypeDescriptor {
  type: CreatablePageType
  label: string
  Icon: IconComponent
  /** Used to surface results when the user types a page-type name into search. */
  keywords: string[]
}

/**
 * Single source of truth for creatable page types — consumed by the create
 * dialog's grid and anywhere else that needs to render the list of types. The
 * order is the display order.
 */
export const CREATABLE_PAGE_TYPES: PageTypeDescriptor[] = [
  { type: 'TEXT', label: 'Текст', Icon: DescriptionIcon, keywords: ['текст', 'заметка', 'text'] },
  {
    type: 'EXCALIDRAW',
    label: 'Холст',
    Icon: BrushIcon,
    keywords: ['холст', 'excalidraw', 'рисунок', 'canvas'],
  },
  {
    type: 'DRAWIO',
    label: 'Draw.io',
    Icon: SchemaIcon,
    keywords: ['drawio', 'диаграмма', 'схема'],
  },
  {
    type: 'GENOGRAM',
    label: 'Генограмма',
    Icon: AccountTreeIcon,
    keywords: ['генограмма', 'genogram', 'семья'],
  },
  {
    type: 'KANBAN',
    label: 'Канбан',
    Icon: ViewKanbanIcon,
    keywords: ['канбан', 'kanban', 'доска', 'задачи'],
  },
  {
    type: 'DATABASE',
    label: 'База данных',
    Icon: StorageIcon,
    keywords: ['база данных', 'database', 'таблица', 'table'],
  },
  {
    type: 'MERMAID',
    label: 'MermaidJS',
    Icon: SchemaIcon,
    keywords: ['mermaid', 'диаграмма', 'схема'],
  },
  {
    type: 'PLANTUML',
    label: 'PlantUML',
    Icon: SchemaIcon,
    keywords: ['plantuml', 'uml', 'диаграмма'],
  },
  {
    type: 'LIKEC4',
    label: 'LikeC4',
    Icon: SchemaIcon,
    keywords: ['likec4', 'c4', 'архитектура', 'диаграмма'],
  },
]

/**
 * Page types that have an icon/label for *listing* (sidebar, search, history) but
 * are NOT created via the generic `page.create` path (the FORM precedent). MEETING
 * pages are born from a recording-upload flow, and DASHBOARD pages from a dedicated
 * `dashboard.create` mutation — so `pageTypeLabel`/`pageTypeIcon` still need their
 * display meta everywhere a page is listed.
 */
const NON_CREATABLE_PAGE_TYPE_META: Partial<
  Record<PageType, { label: string; Icon: IconComponent }>
> = {
  MEETING: { label: 'Встреча', Icon: MicIcon },
  DASHBOARD: { label: 'Дашборд', Icon: DashboardIcon },
}

/**
 * Page types offered in the "+" create grid that DON'T go through the generic
 * `page.create` path: DASHBOARD runs its own `dashboard.create` mutation, MEETING
 * opens the recording-upload dialog. The dialog special-cases these in its select
 * handler, so they live here rather than in `CREATABLE_PAGE_TYPES` (which means
 * "creatable via plain page.create"). MEETING carries an action-flavoured tile
 * label («Загрузить встречу») distinct from its listing label («Встреча»).
 */
export type SpecialCreateType = Extract<PageType, 'DASHBOARD' | 'MEETING'>

export interface SpecialCreateTile {
  type: SpecialCreateType
  label: string
  Icon: IconComponent
}

export const SPECIAL_CREATE_TILES: SpecialCreateTile[] = [
  { type: 'DASHBOARD', label: NON_CREATABLE_PAGE_TYPE_META.DASHBOARD!.label, Icon: DashboardIcon },
  { type: 'MEETING', label: 'Загрузить встречу', Icon: MicIcon },
]

/** Icon component for a page type, for rendering template cards/results. */
export function pageTypeIcon(type: PageType): IconComponent {
  return (
    CREATABLE_PAGE_TYPES.find((d) => d.type === type)?.Icon ??
    NON_CREATABLE_PAGE_TYPE_META[type]?.Icon ??
    DescriptionIcon
  )
}

/** Human label for a page type. */
export function pageTypeLabel(type: PageType): string {
  return (
    CREATABLE_PAGE_TYPES.find((d) => d.type === type)?.label ??
    NON_CREATABLE_PAGE_TYPE_META[type]?.label ??
    'Страница'
  )
}
