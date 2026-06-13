import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { embedsPrefKey, readEmbedsEnabled, writeEmbedsEnabled } from './embed-prefs'

// The editor vitest runs in a node env with no Storage, and the bundled
// happy-dom build here doesn't implement the Storage API on `localStorage`. We
// install a spec-conformant Map-backed shim so these tests exercise the real
// read/write/default logic, not a DOM polyfill quirk.
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}

const g = globalThis as unknown as { localStorage?: Storage; window?: unknown }
let restore: (() => void) | null = null

beforeAll(() => {
  const prev = g.localStorage
  g.localStorage = new MemStorage() as unknown as Storage
  restore = () => {
    if (prev === undefined) delete g.localStorage
    else g.localStorage = prev
  }
})

afterAll(() => restore?.())

describe('embedsPrefKey', () => {
  it('namespaces by pageId', () => {
    expect(embedsPrefKey('page-123')).toBe('anynote:embeds:page-123')
  })
})

describe('readEmbedsEnabled', () => {
  beforeEach(() => {
    g.localStorage!.clear()
  })

  it('defaults to ON when nothing is stored', () => {
    expect(readEmbedsEnabled('p1')).toBe(true)
  })

  it('returns false only when explicitly disabled', () => {
    g.localStorage!.setItem('anynote:embeds:p1', 'off')
    expect(readEmbedsEnabled('p1')).toBe(false)
  })

  it('treats any non-off value as ON (default-safe)', () => {
    g.localStorage!.setItem('anynote:embeds:p1', 'on')
    expect(readEmbedsEnabled('p1')).toBe(true)
    g.localStorage!.setItem('anynote:embeds:p1', 'garbage')
    expect(readEmbedsEnabled('p1')).toBe(true)
  })

  it('returns the default when localStorage throws (SSR / privacy mode)', () => {
    const spy = vi.spyOn(g.localStorage!, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readEmbedsEnabled('p1')).toBe(true)
    spy.mockRestore()
  })
})

describe('writeEmbedsEnabled', () => {
  beforeEach(() => {
    g.localStorage!.clear()
  })

  it('round-trips through readEmbedsEnabled', () => {
    writeEmbedsEnabled('p2', false)
    expect(readEmbedsEnabled('p2')).toBe(false)
    writeEmbedsEnabled('p2', true)
    expect(readEmbedsEnabled('p2')).toBe(true)
  })

  it('swallows write errors (privacy mode)', () => {
    const spy = vi.spyOn(g.localStorage!, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeEmbedsEnabled('p3', false)).not.toThrow()
    spy.mockRestore()
  })
})
