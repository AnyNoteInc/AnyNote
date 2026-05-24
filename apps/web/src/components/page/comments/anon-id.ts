const KEY = 'anynote.anonId'

/** Stable per-browser anonymous id, used to attribute (and edit/delete own)
 * comments left via a public link without an account. */
export function getAnonId(): string {
  if (globalThis.window === undefined) return ''
  let id = globalThis.localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    globalThis.localStorage.setItem(KEY, id)
  }
  return id
}
