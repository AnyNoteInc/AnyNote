import { unzipSync } from 'fflate'

/** User-facing import source problems (message is shown as the job error). */
export class ImportSourceError extends Error {}

const DOC_EXTS = new Set(['md', 'markdown', 'html', 'htm'])
// SVG deliberately excluded: /api/files/[id] serves inline with the stored MIME,
// so importable SVG would be a same-origin XSS vector.
const ASSET_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export type ImportDoc = {
  sourceKey: string
  baseName: string
  format: 'md' | 'html'
  bytes: Uint8Array
}

export type ImportAsset = { sourceKey: string; baseName: string; ext: string; bytes: Uint8Array }

export type ImportNode = {
  /** Display name: folder name or doc filename without extension. */
  name: string
  /** Mapping key: the doc path, or `<dir>/` for doc-less folder nodes. */
  sourceKey: string
  doc: ImportDoc | null
  children: ImportNode[]
}

export type ImportPlan = {
  roots: ImportNode[]
  assets: Map<string, ImportAsset>
  warnings: string[]
  /** Number of pages the import will create — one per tree node, INCLUDING doc-less folder nodes (each becomes a container page). */
  totalPages: number
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
}

function baseNameOf(path: string): string {
  const seg = path.split('/').at(-1) ?? path
  const dot = seg.lastIndexOf('.')
  return dot <= 0 ? seg : seg.slice(0, dot)
}

function dirNameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? '' : path.slice(0, idx)
}

/** Normalize one zip entry path; null = ignore the entry; throws on traversal. */
export function normalizeEntryPath(raw: string): string | null {
  const path = raw.replaceAll('\\', '/').replace(/\/+$/, '')
  if (path === '') return null
  if (path.startsWith('/')) throw new ImportSourceError('Небезопасный путь в архиве')
  const segs = path.split('/')
  if (segs.some((s) => s === '..')) throw new ImportSourceError('Небезопасный путь в архиве')
  if (segs.length > 200) throw new ImportSourceError('Слишком глубокая структура архива')
  if (segs.some((s) => s === '__MACOSX' || s === '.DS_Store' || s.startsWith('._'))) return null
  const result = segs.filter((s) => s !== '' && s !== '.').join('/')
  return result === '' ? null : result
}

export function buildImportPlan(zipBytes: Uint8Array): ImportPlan {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zipBytes)
  } catch {
    throw new ImportSourceError('Не удалось прочитать ZIP-архив')
  }

  const docs = new Map<string, ImportDoc>()
  const assets = new Map<string, ImportAsset>()
  const warnings: string[] = []
  const dirs = new Set<string>()

  for (const [raw, bytes] of Object.entries(entries)) {
    if (raw.endsWith('/')) continue // directory marker entries
    const path = normalizeEntryPath(raw)
    if (path === null) continue
    const ext = extOf(path)
    if (DOC_EXTS.has(ext)) {
      // Only doc paths spawn container dirs: a folder holding nothing but
      // assets (e.g. `img/`) must not become an empty page.
      for (let d = dirNameOf(path); d !== ''; d = dirNameOf(d)) dirs.add(d)
      docs.set(path, {
        sourceKey: path,
        baseName: baseNameOf(path),
        format: ext === 'html' || ext === 'htm' ? 'html' : 'md',
        bytes,
      })
    } else if (ASSET_EXTS.has(ext)) {
      assets.set(path, { sourceKey: path, baseName: baseNameOf(path), ext, bytes })
    } else {
      warnings.push(`Пропущен файл «${path}» — формат не поддерживается`)
    }
  }

  // Build folder nodes for every dir.
  const nodeByDir = new Map<string, ImportNode>()
  for (const dir of dirs) {
    nodeByDir.set(dir, {
      name: dir.split('/').at(-1)!,
      sourceKey: `${dir}/`,
      doc: null,
      children: [],
    })
  }

  // Merge `<dir>.md|html` onto a sibling folder node `<dir>/` (wiki convention).
  const merged = new Set<string>()
  for (const [path, doc] of docs) {
    const candidateDir =
      dirNameOf(path) === '' ? doc.baseName : `${dirNameOf(path)}/${doc.baseName}`
    const target = nodeByDir.get(candidateDir)
    if (target && target.doc === null) {
      target.doc = doc
      target.sourceKey = path // mapping keys on the doc path
      merged.add(path)
    }
  }

  // Leaf doc nodes.
  const leaves: Array<{ dir: string; node: ImportNode }> = []
  for (const [path, doc] of docs) {
    if (merged.has(path)) continue
    leaves.push({
      dir: dirNameOf(path),
      node: { name: doc.baseName, sourceKey: path, doc, children: [] },
    })
  }

  // Assemble the tree.
  const roots: ImportNode[] = []
  const attach = (dir: string, node: ImportNode) => {
    if (dir === '') roots.push(node)
    else nodeByDir.get(dir)!.children.push(node)
  }
  for (const dir of dirs) attach(dirNameOf(dir), nodeByDir.get(dir)!)
  for (const { dir, node } of leaves) attach(dir, node)

  const sortRec = (nodes: ImportNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)

  let totalPages = 0
  const count = (nodes: ImportNode[]) => {
    for (const n of nodes) {
      totalPages += 1
      count(n.children)
    }
  }
  count(roots)

  return { roots, assets, warnings, totalPages }
}
