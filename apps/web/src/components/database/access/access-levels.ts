import type { RouterOutputs } from '@/trpc/client'

/**
 * The five database access levels, as a string-literal union. Mirrors the
 * `DatabaseAccessLevel` Prisma enum (`@repo/db`) but is declared locally as a
 * TYPE so we never pull the `@repo/db` runtime (and its PrismaPg/pg adapter) into
 * the client bundle — the same constraint `types.ts` documents for the dto leaf.
 * The server validates the level on every write, so the client only needs the shape.
 */
export type DatabaseAccessLevelValue =
  | 'CAN_VIEW'
  | 'CAN_COMMENT'
  | 'CAN_EDIT_CONTENT'
  | 'CAN_EDIT'
  | 'FULL_ACCESS'

/** A persisted access rule as returned by `database.listAccessRules`. */
export type AccessRuleView = RouterOutputs['database']['listAccessRules'][number]

/** The level options rendered in the access-level Select (ordered low → high). */
export const ACCESS_LEVEL_OPTIONS: ReadonlyArray<{
  value: DatabaseAccessLevelValue
  label: string
}> = [
  { value: 'CAN_VIEW', label: 'Просмотр' },
  { value: 'CAN_COMMENT', label: 'Комментирование' },
  { value: 'CAN_EDIT_CONTENT', label: 'Редактирование содержимого' },
  { value: 'CAN_EDIT', label: 'Редактирование' },
  { value: 'FULL_ACCESS', label: 'Полный доступ' },
]
