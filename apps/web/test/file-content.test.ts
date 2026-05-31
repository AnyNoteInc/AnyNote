import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'

// file-content.ts imports `server-only`, which throws when imported outside an
// RSC bundle (e.g. vitest's node env). Neutralise it for the unit test.
vi.mock('server-only', () => ({}))

import { resolveAttachmentContents, MAX_TOTAL_INLINE_BYTES } from '../src/lib/chat/file-content'

function fakeStorage(payloads: Record<string, Buffer>) {
  return {
    get: vi.fn(async (key: string) => Readable.from(payloads[key]!)),
  } as unknown as import('@repo/storage').StorageClient
}

const baseFile = {
  id: 'f1',
  name: 'a.md',
  ext: 'md',
  mimeType: 'text/markdown',
  fileSize: 5n,
  path: 'k1',
}

describe('resolveAttachmentContents', () => {
  it('inlines a small text file', async () => {
    const storage = fakeStorage({ k1: Buffer.from('hello', 'utf8') })
    const res = (await resolveAttachmentContents(storage, [baseFile]))[0]!
    expect(res.included).toBe(true)
    expect(res.content).toBe('hello')
  })

  it('caps a file over the per-file limit', async () => {
    const big = Buffer.alloc(300 * 1024, 0x61)
    const storage = fakeStorage({ k1: big })
    const res = (
      await resolveAttachmentContents(storage, [{ ...baseFile, fileSize: BigInt(big.length) }])
    )[0]!
    expect(Buffer.from(res.content ?? '', 'utf8').length).toBeLessThanOrEqual(256 * 1024)
  })

  it('excludes non-whitelist binary as metadata-only', async () => {
    const storage = fakeStorage({ k1: Buffer.from([0, 1, 2]) })
    const res = (
      await resolveAttachmentContents(storage, [
        { ...baseFile, name: 'a.zip', ext: 'zip', mimeType: 'application/zip' },
      ])
    )[0]!
    expect(res.included).toBe(false)
    expect(res.content).toBeUndefined()
    expect(res.reason).toBeTruthy()
  })

  it('flips later files past the total budget to excluded', async () => {
    const chunk = Buffer.alloc(200 * 1024, 0x61) // 200KB each
    const storage = fakeStorage({ k1: chunk, k2: chunk, k3: chunk })
    const files = [
      { ...baseFile, id: 'f1', path: 'k1', fileSize: BigInt(chunk.length) },
      { ...baseFile, id: 'f2', path: 'k2', fileSize: BigInt(chunk.length) },
      { ...baseFile, id: 'f3', path: 'k3', fileSize: BigInt(chunk.length) },
    ]
    const out = await resolveAttachmentContents(storage, files)
    const includedBytes = out
      .filter((r) => r.included)
      .reduce((n, r) => n + Buffer.from(r.content ?? '', 'utf8').length, 0)
    expect(includedBytes).toBeLessThanOrEqual(MAX_TOTAL_INLINE_BYTES)
    expect(out.some((r) => !r.included)).toBe(true)
  })

  it('degrades to a fixed reason when reading throws (no message leak)', async () => {
    const storage = {
      get: vi.fn(async () => {
        throw new Error('SECRET s3 key /buckets/abc/leak.md not found')
      }),
    } as unknown as import('@repo/storage').StorageClient
    const res = (await resolveAttachmentContents(storage, [baseFile]))[0]!
    expect(res.included).toBe(false)
    expect(res.reason).toBe('extraction failed')
    expect(res.reason).not.toContain('SECRET')
  })
})
