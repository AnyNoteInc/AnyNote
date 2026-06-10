import type { TiptapDoc, TiptapNode } from './markdown-to-tiptap'

/** Resolve a relative href against a source dir; null when it escapes the root. */
export function resolveSourcePath(fromDir: string, href: string): string | null {
  const segs = [...(fromDir ? fromDir.split('/') : []), ...href.split('/')]
  const out: string[] = []
  for (const s of segs) {
    if (s === '' || s === '.') continue
    if (s === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(s)
  }
  return out.length > 0 ? out.join('/') : null
}

function isExternal(href: string): boolean {
  return (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('#') ||
    href.startsWith('/')
  )
}

/**
 * Second import pass: rewrite link marks whose relative href resolves (via the
 * caller's mapping) to an imported page. `resolve` receives the absolute source
 * path (e.g. `Proj/target.md`) and returns the internal href or null.
 */
export function rewriteRelativeLinks(
  doc: TiptapDoc,
  args: { sourceKey: string; resolve: (absoluteSourcePath: string) => string | null },
): { doc: TiptapDoc; changed: boolean } {
  const fromDir = args.sourceKey.includes('/')
    ? args.sourceKey.slice(0, args.sourceKey.lastIndexOf('/'))
    : ''
  let changed = false

  const visit = (node: TiptapNode): TiptapNode => {
    let marks = node.marks
    if (marks) {
      marks = marks.map((m) => {
        if (m.type !== 'link') return m
        const href = typeof m.attrs?.href === 'string' ? m.attrs.href : null
        if (!href || isExternal(href)) return m
        const [path, fragment] = href.split('#', 2)
        let decoded = path ?? ''
        try {
          decoded = decodeURIComponent(decoded)
        } catch {
          // keep raw on malformed escapes
        }
        const abs = resolveSourcePath(fromDir, decoded)
        const target = abs ? args.resolve(abs) : null
        if (!target) return m
        changed = true
        return {
          ...m,
          attrs: { ...m.attrs, href: fragment ? `${target}#${fragment}` : target },
        }
      })
    }
    return {
      ...node,
      ...(marks ? { marks } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    }
  }

  const out: TiptapDoc = { type: 'doc', content: doc.content.map(visit) }
  return { doc: out, changed }
}
