import { unzipSync } from 'fflate'
import { parseHTML } from 'linkedom'

import {
  ASSET_EXTS,
  buildPlanFromFiles,
  ImportSourceError,
  normalizeEntryPath,
  type ImportPlan,
} from '../zip-plan'

export type ConfluenceImportPlan = ImportPlan & {
  /** Raw entry path → cleaned (renamed) doc path, for inter-page link resolution. */
  aliases: Map<string, string>
}

const CHROME_SELECTOR = '#breadcrumbs, #footer, .page-metadata, #navigation, .pageSection.group'
const CONFLUENCE_LIMITATIONS_NOTE =
  'Confluence: права, история, комментарии и макросы не переносятся'

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

/** Strip Confluence chrome and derive the page title from `<title>` (suffix dropped). */
function precleanConfluenceHtml(
  bytes: Uint8Array,
  fallbackTitle: string,
): { title: string; html: string } {
  const source = new TextDecoder().decode(bytes)
  const { document } = parseHTML(source)
  for (const el of Array.from(document.querySelectorAll(CHROME_SELECTOR))) el.remove()
  const titleText = document.querySelector('title')?.textContent?.trim() ?? ''
  const sep = titleText.lastIndexOf(' - ')
  // '/' in a title would read as a path separator downstream (phantom folders) — swap for U+2215.
  const title = (
    (sep > 0 ? titleText.slice(0, sep) : titleText).trim() || fallbackTitle
  ).replaceAll('/', '∕')
  const main = document.querySelector('#main-content')
  const html = (main ? main.innerHTML : (document.body?.innerHTML ?? source)) || ''
  return { title, html }
}

export function buildConfluenceImportPlan(zipBytes: Uint8Array): ConfluenceImportPlan {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zipBytes)
  } catch {
    throw new ImportSourceError('Не удалось прочитать ZIP-архив')
  }

  const warnings: string[] = []
  const aliases = new Map<string, string>()
  const files: Array<{ path: string; bytes: Uint8Array }> = []
  let docCount = 0
  let assetCount = 0

  // Cleaned-name claims (collision-suffixed like the Notion builder).
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

  for (const [raw, bytes] of Object.entries(entries)) {
    if (raw.endsWith('/')) continue // directory marker entries
    const path = normalizeEntryPath(raw)
    if (path === null) continue
    const ext = extOf(path)
    const { stem, ext: dottedExt } = splitLastSegment(path)
    if (`${stem}${dottedExt}`.toLowerCase() === 'index.html') {
      warnings.push('Пропущен index.html — оглавление не импортируется')
      continue
    }
    if (ext === 'html' || ext === 'htm') {
      const { title, html } = precleanConfluenceHtml(bytes, stem)
      const cleaned = claim(dirNameOf(path), title, dottedExt)
      files.push({ path: cleaned, bytes: new TextEncoder().encode(html) })
      aliases.set(path, cleaned)
      docCount += 1
      continue
    }
    if (ASSET_EXTS.has(ext)) {
      // Confluence hrefs reference `attachments/...` relatively — keyed by full path.
      files.push({ path, bytes })
      assetCount += 1
      continue
    }
    warnings.push(`Вложение «${path}» не импортировано`)
  }

  const plan = buildPlanFromFiles(files)
  plan.warnings.push(...warnings)
  if (docCount > 0 || assetCount > 0) plan.warnings.push(CONFLUENCE_LIMITATIONS_NOTE)
  return { ...plan, aliases }
}
