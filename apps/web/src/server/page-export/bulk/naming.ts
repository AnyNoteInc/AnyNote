// Mirrors the UNSAFE class in ../filename.ts (kept separate: entry names have no
// extension and need per-directory dedup).
const UNSAFE = new RegExp(
  `[/\\\\:*?"<>|${String.fromCharCode(0)}-${String.fromCharCode(31)}]+`,
  'g',
)

export function safeEntryName(rawTitle: string | null | undefined): string {
  const trimmed = (rawTitle ?? '').trim()
  if (!trimmed) return 'Без названия'
  // 80 (not 100 like filename.ts): head-room for the " N" dedup suffix
  const safe = trimmed.replaceAll(UNSAFE, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 80)
  return safe || 'page'
}

/** Per-directory case-insensitive name dedup: "Page", "page 2", "page 3"… */
export function createNameAllocator(): (dir: string, base: string) => string {
  const used = new Map<string, number>()
  return (dir, base) => {
    const key = `${dir}|${base.toLowerCase()}`
    const n = (used.get(key) ?? 0) + 1
    used.set(key, n)
    return n === 1 ? base : `${base} ${n}`
  }
}

/** Relative path from a directory ('' = archive root) to an archive entry path. */
export function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir === '' ? [] : fromDir.split('/')
  const to = toPath.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i += 1
  const ups = from.length - i
  return [...Array.from({ length: ups }, () => '..'), ...to.slice(i)].join('/')
}
