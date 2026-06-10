import { unzipSync } from 'fflate'

import { parseCsv } from '../csv'
import {
  ASSET_EXTS,
  buildPlanFromFiles,
  DOC_EXTS,
  ImportSourceError,
  normalizeEntryPath,
  type ImportDoc,
  type ImportPlan,
} from '../zip-plan'
import { splitNotionName } from './notion-name'

export type NotionDatabaseBlueprint = {
  /** Mapping key for the DATABASE page (the csv's cleaned path). */
  sourceKey: string
  /** Cleaned parent dir ('' = import root) — resolved to a parent page at materialization. */
  parentKey: string
  title: string
  notionId: string | null
  header: string[]
  rows: string[][]
  /** Row title → the row's source .md/.html doc (content merged into the item page). */
  rowDocs: Map<string, ImportDoc>
  /** Row title → the row doc's notion id (registered as a row alias). */
  rowAliasIds: Map<string, string>
}

export type NotionImportPlan = ImportPlan & {
  aliases: Map<string, string>
  databases: NotionDatabaseBlueprint[]
}

const NOTION_LIMITATIONS_NOTE = 'Комментарии, права доступа и история Notion не переносятся'

type RawFile = { raw: string; bytes: Uint8Array }

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
}

function dirNameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? '' : path.slice(0, idx)
}

/** Split the LAST path segment into stem + dotted extension ('' when none). */
function splitLastSegment(path: string): { stem: string; ext: string } {
  const seg = path.split('/').at(-1) ?? path
  const dot = seg.lastIndexOf('.')
  return dot > 0 ? { stem: seg.slice(0, dot), ext: seg.slice(dot) } : { stem: seg, ext: '' }
}

function docFormat(ext: string): 'md' | 'html' {
  return ext === 'html' || ext === 'htm' ? 'html' : 'md'
}

export function buildNotionImportPlan(zipBytes: Uint8Array): NotionImportPlan {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zipBytes)
  } catch {
    throw new ImportSourceError('Не удалось прочитать ZIP-архив')
  }

  const rawFiles: RawFile[] = []
  for (const [raw, bytes] of Object.entries(entries)) {
    if (raw.endsWith('/')) continue // directory marker entries
    const path = normalizeEntryPath(raw)
    if (path === null) continue
    rawFiles.push({ raw: path, bytes })
  }
  const rawPaths = new Set(rawFiles.map((f) => f.raw))

  // Database candidates: every `.csv`; `_all.csv` duplicates are dropped when the
  // non-_all twin exists, otherwise promoted with the `_all` stripped from the stem.
  const skippedCsvs = new Set<string>()
  const candidateStemByCsvPath = new Map<string, string>()
  for (const f of rawFiles) {
    if (extOf(f.raw) !== 'csv') continue
    const stem = f.raw.slice(0, -'.csv'.length)
    if (stem.endsWith('_all')) {
      const base = stem.slice(0, -'_all'.length)
      if (rawPaths.has(`${base}.csv`)) skippedCsvs.add(f.raw)
      else candidateStemByCsvPath.set(f.raw, base)
    } else {
      candidateStemByCsvPath.set(f.raw, stem)
    }
  }
  const candidateStems = [...candidateStemByCsvPath.values()]
  const ownerStemOf = (raw: string): string | null => {
    let best: string | null = null
    for (const stem of candidateStems) {
      if (raw.startsWith(`${stem}/`) && (best === null || stem.length > best.length)) best = stem
    }
    return best
  }

  // Cleaned-name claims: deterministic by entry iteration order; collisions get
  // ` ${n}` appended to the stem of the final segment (case-insensitive keys).
  const taken = new Set<string>()
  const claim = (dir: string, name: string, ext: string): string => {
    const prefix = dir === '' ? '' : `${dir}/`
    let finalName = `${name}${ext}`
    if (taken.has(`${prefix}${finalName}`.toLowerCase())) {
      let n = 2
      while (taken.has(`${prefix}${name} ${n}${ext}`.toLowerCase())) n += 1
      finalName = `${name} ${n}${ext}`
    }
    taken.add(`${prefix}${finalName}`.toLowerCase())
    return `${prefix}${finalName}`
  }
  const cleanedDirByRaw = new Map<string, string>([['', '']])
  const cleanDir = (rawDir: string): string => {
    const hit = cleanedDirByRaw.get(rawDir)
    if (hit !== undefined) return hit
    const parentCleaned = cleanDir(dirNameOf(rawDir))
    const seg = rawDir.split('/').at(-1) ?? rawDir
    const cleaned = claim(parentCleaned, splitNotionName(seg).title, '')
    cleanedDirByRaw.set(rawDir, cleaned)
    return cleaned
  }

  const aliases = new Map<string, string>()
  const databases: NotionDatabaseBlueprint[] = []
  const blueprintByStem = new Map<string, NotionDatabaseBlueprint>()
  const pendingRowDocs = new Map<string, RawFile[]>()
  const files: Array<{ path: string; bytes: Uint8Array }> = []
  let docCount = 0
  let assetCount = 0

  for (const f of rawFiles) {
    const classifyExt = extOf(f.raw)
    if (classifyExt === 'csv') {
      if (skippedCsvs.has(f.raw)) continue
      const stem = candidateStemByCsvPath.get(f.raw)!
      const cleanedDir = cleanDir(dirNameOf(f.raw))
      const { title, notionId } = splitNotionName(splitLastSegment(`${stem}.csv`).stem)
      const sourceKey = claim(cleanedDir, title, '.csv')
      const parsed = parseCsv(new TextDecoder().decode(f.bytes))
      const blueprint: NotionDatabaseBlueprint = {
        sourceKey,
        parentKey: cleanedDir,
        title,
        notionId,
        header: parsed[0] ?? [],
        rows: parsed.slice(1),
        rowDocs: new Map(),
        rowAliasIds: new Map(),
      }
      databases.push(blueprint)
      blueprintByStem.set(stem, blueprint)
      aliases.set(f.raw, sourceKey)
      if (notionId) aliases.set(notionId, sourceKey)
      continue
    }

    const ownerStem = DOC_EXTS.has(classifyExt) ? ownerStemOf(f.raw) : null
    if (ownerStem !== null) {
      // Row doc of a database candidate — leaves the page tree, attached below.
      const pending = pendingRowDocs.get(ownerStem)
      if (pending) pending.push(f)
      else pendingRowDocs.set(ownerStem, [f])
      continue
    }

    const { stem, ext } = splitLastSegment(f.raw)
    const { title, notionId } = splitNotionName(stem)
    const cleaned = claim(cleanDir(dirNameOf(f.raw)), title, ext)
    files.push({ path: cleaned, bytes: f.bytes })
    if (DOC_EXTS.has(classifyExt)) {
      docCount += 1
      aliases.set(f.raw, cleaned)
      if (notionId) aliases.set(notionId, cleaned)
    } else if (ASSET_EXTS.has(classifyExt)) {
      assetCount += 1
      // Notion markdown references assets by their RAW (id-suffixed) paths, so
      // register the same bytes under the raw path too (dedup'd by hash downstream).
      if (f.raw !== cleaned) files.push({ path: f.raw, bytes: f.bytes })
    }
  }

  // Attach row docs to their blueprints (first doc per row title wins).
  for (const [stem, rowFiles] of pendingRowDocs) {
    const blueprint = blueprintByStem.get(stem)
    if (!blueprint) continue
    const cleanedDir = cleanDir(stem)
    for (const f of rowFiles) {
      const { stem: fileStem, ext } = splitLastSegment(f.raw)
      const { title, notionId } = splitNotionName(fileStem)
      if (blueprint.rowDocs.has(title)) continue
      const sourceKey = claim(cleanedDir, title, ext)
      blueprint.rowDocs.set(title, {
        sourceKey,
        baseName: title,
        format: docFormat(extOf(f.raw)),
        bytes: f.bytes,
      })
      if (notionId) blueprint.rowAliasIds.set(title, notionId)
      // Links to row docs resolve through the row mapping keys (Task 9 records
      // onRowCreated under these sourceKeys).
      aliases.set(f.raw, sourceKey)
      if (notionId) aliases.set(notionId, sourceKey)
    }
  }

  const plan = buildPlanFromFiles(files)
  const totalPages = plan.totalPages + databases.reduce((acc, bp) => acc + 1 + bp.rows.length, 0)
  if (docCount > 0 || assetCount > 0 || databases.length > 0) {
    plan.warnings.push(NOTION_LIMITATIONS_NOTE)
  }
  return { ...plan, totalPages, aliases, databases }
}
