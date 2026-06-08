'use client'

import {
  AccountTreeIcon,
  BrushIcon,
  DescriptionIcon,
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
  { type: 'EXCALIDRAW', label: 'Холст', Icon: BrushIcon, keywords: ['холст', 'excalidraw', 'рисунок', 'canvas'] },
  { type: 'DRAWIO', label: 'Draw.io', Icon: SchemaIcon, keywords: ['drawio', 'диаграмма', 'схема'] },
  { type: 'GENOGRAM', label: 'Генограмма', Icon: AccountTreeIcon, keywords: ['генограмма', 'genogram', 'семья'] },
  { type: 'KANBAN', label: 'Канбан', Icon: ViewKanbanIcon, keywords: ['канбан', 'kanban', 'доска', 'задачи'] },
  { type: 'DATABASE', label: 'База данных', Icon: StorageIcon, keywords: ['база данных', 'database', 'таблица', 'table'] },
  { type: 'MERMAID', label: 'MermaidJS', Icon: SchemaIcon, keywords: ['mermaid', 'диаграмма', 'схема'] },
  { type: 'PLANTUML', label: 'PlantUML', Icon: SchemaIcon, keywords: ['plantuml', 'uml', 'диаграмма'] },
  { type: 'LIKEC4', label: 'LikeC4', Icon: SchemaIcon, keywords: ['likec4', 'c4', 'архитектура', 'диаграмма'] },
]

/** Icon component for a page type, for rendering template cards/results. */
export function pageTypeIcon(type: PageType): IconComponent {
  return CREATABLE_PAGE_TYPES.find((d) => d.type === type)?.Icon ?? DescriptionIcon
}

/** Human label for a page type. */
export function pageTypeLabel(type: PageType): string {
  return CREATABLE_PAGE_TYPES.find((d) => d.type === type)?.label ?? 'Страница'
}
