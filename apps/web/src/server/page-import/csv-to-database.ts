import { DatabasePropertyType, PageType, type Prisma, type PrismaClient } from '@repo/db'
import { isDomainError, type Domain } from '@repo/domain'

import { buildImportContentYjs } from '@/server/page-import/content-yjs'
import { parseHtmlDocument } from '@/server/page-import/html-to-tiptap'
import { parseMarkdownDocument } from '@/server/page-import/markdown-to-tiptap'
import {
  inferColumns,
  type InferOverrides,
  type InferredColumn,
  type InferredType,
} from '@/server/page-import/infer-columns'
import type { ImportJournal } from '@/server/page-import/journal'
import type { ImportDoc } from '@/server/page-import/zip-plan'
import type { PagesCreatePort } from '@/server/jobs/process-import-job'

/** Structural subset of the database domain service the materializer needs. */
export type DatabasePort = Pick<
  Domain['database'],
  'listProperties' | 'createProperty' | 'deleteProperty' | 'createRow' | 'updateCellValue'
>

export type CsvDatabaseBlueprint = {
  sourceKey: string
  title: string
  header: string[]
  rows: string[][]
  /** Optional per-row documents (Notion CSV+md pairs) keyed by row TITLE. */
  rowDocs?: Map<string, ImportDoc>
}

export type MaterializeContext = {
  prisma: PrismaClient
  pages: PagesCreatePort
  database: DatabasePort
}

export type MaterializeArgs = {
  actorUserId: string
  workspaceId: string
  parentPageId: string | null
  location: 'team' | 'private'
  blueprint: CsvDatabaseBlueprint
  journal: ImportJournal
  /** Resume support: keys already imported (db page sourceKey + row keys) → pageId. */
  existingMappings: Map<string, string>
  /** Called after each NEW row's item page exists (record mapping + progress). */
  onRowCreated: (rowKey: string, itemPageId: string) => Promise<void>
  /** Called once when the db page is NEWLY created (record its mapping). */
  onDatabaseCreated: (sourceKey: string, dbPageId: string) => Promise<void>
  /**
   * User type pins/skips keyed by the FULL CSV header index (column 0 = the
   * implicit title column, never overridable). Shifted to data-column indices
   * before reaching `inferColumns`.
   */
  inferOpts?: InferOverrides
}

const INFERRED_TO_PROP: Record<InferredType, DatabasePropertyType> = {
  TEXT: DatabasePropertyType.TEXT,
  NUMBER: DatabasePropertyType.NUMBER,
  CHECKBOX: DatabasePropertyType.CHECKBOX,
  DATE: DatabasePropertyType.DATE,
  SELECT: DatabasePropertyType.SELECT,
  MULTI_SELECT: DatabasePropertyType.MULTI_SELECT,
  URL: DatabasePropertyType.URL,
  EMAIL: DatabasePropertyType.EMAIL,
  PHONE: DatabasePropertyType.PHONE,
}

const TYPE_LABEL: Record<InferredType, string> = {
  TEXT: 'текст',
  NUMBER: 'число',
  CHECKBOX: 'флажок',
  DATE: 'дата',
  SELECT: 'выбор',
  MULTI_SELECT: 'мульти-выбор',
  URL: 'ссылка',
  EMAIL: 'email',
  PHONE: 'телефон',
}

/**
 * Materialize a parsed CSV blueprint as a real DATABASE page through the domain
 * service: page (auto-provisions source + TABLE view), inferred properties, rows
 * (item pages) and cell values. Idempotent resume via `existingMappings`; a
 * malformed cell value degrades to a journal warning instead of failing the job.
 */
export async function materializeCsvDatabase(
  ctx: MaterializeContext,
  args: MaterializeArgs,
): Promise<{ dbPageId: string; createdRows: number }> {
  const { blueprint: bp, journal, existingMappings } = args

  // 1. DB page: reuse the mapped page on resume, else create (seeds STATUS + view).
  let dbPageId = existingMappings.get(bp.sourceKey)
  if (!dbPageId) {
    const created = await ctx.pages.create(args.actorUserId, {
      workspaceId: args.workspaceId,
      parentId: args.parentPageId,
      title: bp.title,
      type: PageType.DATABASE,
      ...(args.parentPageId === null ? { location: args.location } : {}),
    })
    dbPageId = created.id
    await args.onDatabaseCreated(bp.sourceKey, dbPageId)
    // A reclaim-race loser had its page deleted inside the callback (the winner's
    // mapping is authoritative) — adopt the winner's id for the rest of the run.
    dbPageId = existingMappings.get(bp.sourceKey) ?? dbPageId
  }

  // 2. Properties: replace the seeded default STATUS column, then create one
  // property per inferred CSV column (the Title column is implicit: Page.title).
  const existing = await ctx.database.listProperties(args.actorUserId, dbPageId)
  const dataHeader = bp.header.slice(1)
  const seeded = existing.length === 1 ? existing[0] : undefined
  let reusable = existing
  if (
    seeded &&
    seeded.type === DatabasePropertyType.STATUS &&
    seeded.name === 'Статус' &&
    dataHeader.length >= 1
  ) {
    await ctx.database.deleteProperty(args.actorUserId, { pageId: dbPageId, id: seeded.id })
    journal.action('Замена свойства по умолчанию')
    reusable = []
  }

  // Overrides arrive keyed by the FULL header index; the title column (0) is
  // sliced off above, so shift every key by -1 for the data-column inference.
  const dataOverrides: Record<number, InferredType | 'skip'> = {}
  for (const [key, value] of Object.entries(args.inferOpts?.overrides ?? {})) {
    const idx = Number(key)
    if (Number.isInteger(idx) && idx >= 1) dataOverrides[idx - 1] = value
  }
  const inferred = inferColumns(
    dataHeader,
    bp.rows.map((r) => r.slice(1)),
    { overrides: dataOverrides },
  )
  // `colIdx` preserves the inferred-column index (skipped columns leave holes)
  // so cell lookups below stay aligned with the raw row values.
  const cols: Array<{ propertyId: string; col: InferredColumn; colIdx: number }> = []
  for (const [colIdx, col] of inferred.entries()) {
    if (col.skip) continue
    // Resume-time reuse must match name AND type — a same-name property of a
    // different type (e.g. user-edited between runs) gets a fresh property.
    const match = reusable.find((p) => p.name === col.name && p.type === INFERRED_TO_PROP[col.type])
    const propertyId = match
      ? match.id
      : (
          await ctx.database.createProperty(args.actorUserId, {
            pageId: dbPageId,
            type: INFERRED_TO_PROP[col.type],
            name: col.name,
            ...(col.options ? { settings: { options: col.options } } : {}),
          })
        ).id
    journal.action(`Колонка «${col.name}» → ${TYPE_LABEL[col.type]}`)
    cols.push({ propertyId, col, colIdx })
  }

  // 3. Rows: one item page per CSV row; cells through the domain (per-cell
  // degradation); optional row document becomes the item page content.
  let createdRows = 0
  // Same-titled rows must not share the first row's doc-derived key (the later
  // ones would be skipped as already-imported): only the FIRST occurrence of a
  // title claims the rowDoc; duplicates fall back to the positional key.
  const titlesSeen = new Set<string>()
  const duplicatesWarned = new Set<string>()
  for (const [idx, row] of bp.rows.entries()) {
    const title = row[0]?.trim() || 'Без названия'
    const firstOfTitle = !titlesSeen.has(title)
    titlesSeen.add(title)
    if (!firstOfTitle && bp.rowDocs?.has(title) && !duplicatesWarned.has(title)) {
      duplicatesWarned.add(title)
      journal.warn(
        `Дубликат строки «${title}» — содержимое страницы строки взято из первого вхождения`,
      )
    }
    const rowDoc = firstOfTitle ? bp.rowDocs?.get(title) : undefined
    const rowKey = rowDoc?.sourceKey ?? `${bp.sourceKey}#${idx}`
    if (existingMappings.has(rowKey)) continue

    const { rowId, pageId: itemPageId } = await ctx.database.createRow(args.actorUserId, {
      pageId: dbPageId,
      title,
    })

    for (const { propertyId, col, colIdx } of cols) {
      const raw = row[colIdx + 1] ?? ''
      const value = col.toValue(raw)
      if (value === null) continue
      try {
        await ctx.database.updateCellValue(args.actorUserId, {
          pageId: dbPageId,
          rowId,
          propertyId,
          value,
        })
      } catch (e) {
        if (!isDomainError(e)) throw e
        journal.warn(`Значение «${raw}» в колонке «${col.name}» пропущено`)
      }
    }

    if (rowDoc) {
      const text = new TextDecoder('utf-8').decode(rowDoc.bytes)
      const parsed =
        rowDoc.format === 'html'
          ? parseHtmlDocument(text, title)
          : parseMarkdownDocument(text, title)
      await ctx.prisma.page.update({
        where: { id: itemPageId },
        data: {
          content: parsed.doc as unknown as Prisma.InputJsonValue,
          contentYjs: buildImportContentYjs(parsed.doc),
        },
      })
      await ctx.prisma.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: itemPageId,
          workspaceId: args.workspaceId,
        },
      })
    }

    await args.onRowCreated(rowKey, itemPageId)
    createdRows += 1
  }

  return { dbPageId, createdRows }
}
