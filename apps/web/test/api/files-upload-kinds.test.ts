import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isInlineSafeMime,
  sniffImageMime,
  sniffMediaMime,
  validateUpload,
} from '../../src/lib/file-validation'

const mocks = vi.hoisted(() => ({
  fileFindFirst: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  fileAggregate: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({
    _sum: { fileSize: 0n },
  })),
  limitFindUnique: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  userUpdate: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
  txFileCreate: vi.fn<(args: unknown) => Promise<unknown>>(),
  txFileCount: vi.fn<(args: unknown) => Promise<number>>(async () => 0),
  txUserUpdate: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
  storagePut: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  storageDelete: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  getSession: vi.fn<() => Promise<unknown>>(),
  getActiveWorkspaceForUser: vi.fn<() => Promise<unknown>>(async () => null),
  workspaceFindFirst: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  txQueryRaw: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => [{ id: 'workspace' }]),
}))

vi.mock('@repo/db', () => ({
  FileStatus: { ACTIVE: 'ACTIVE', PENDING: 'PENDING' },
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  prisma: {
    file: { findFirst: mocks.fileFindFirst, aggregate: mocks.fileAggregate },
    workspace: { findFirst: mocks.workspaceFindFirst },
    workspaceLimit: { findUnique: mocks.limitFindUnique },
    user: { update: mocks.userUpdate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRaw: mocks.txQueryRaw,
        file: {
          create: mocks.txFileCreate,
          aggregate: mocks.fileAggregate,
          count: mocks.txFileCount,
        },
        workspaceLimit: { findUnique: mocks.limitFindUnique },
        user: { update: mocks.txUserUpdate },
      }),
  },
}))

vi.mock('@repo/storage', () => ({
  storage: { put: mocks.storagePut, delete: mocks.storageDelete },
}))

vi.mock('@/lib/get-session', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/active-workspace', () => ({
  getActiveWorkspaceForUser: mocks.getActiveWorkspaceForUser,
}))

import { POST } from '../../src/app/api/files/upload/route'

const USER_ID = '33333333-3333-4333-8333-333333333333'
const MB = 1024 * 1024

const createdRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'f-new-1',
  name: 'pic.png',
  ext: 'png',
  mimeType: 'image/png',
  fileSize: BigInt(10),
  isPublic: true,
  createdAt: new Date('2026-06-17T00:00:00Z'),
  ...overrides,
})

function makeUploadRequest(kind: string, file: File, workspaceId?: string): NextRequest {
  const wsParam = workspaceId === undefined ? '' : `&workspaceId=${workspaceId}`
  const url = `http://localhost:3000/api/files/upload?kind=${kind}${wsParam}`
  const fd = new FormData()
  fd.set('file', file)
  const req = new Request(url, { method: 'POST', body: fd })
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
  return req as unknown as NextRequest
}

// A real 1×1 transparent PNG — magic-byte validation rejects fabricated bytes.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** A File whose content starts with the real PNG, zero-padded up to `bytes`. */
const pngFile = (bytes = PNG_1X1.length, name = 'pic.png') => {
  const buf = new Uint8Array(Math.max(bytes, PNG_1X1.length))
  buf.set(PNG_1X1)
  return new File([buf], name, { type: 'image/png' })
}

// ── Media container signatures (Phase 9B) ────────────────────────────────────
// Minimal-but-real container headers: the leading box/magic the sniffer keys on,
// then a few padding bytes (the sniffer only inspects the first ~16 bytes).
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

/** An `ftyp` box with the given 4-char major brand (offset 4 = "ftyp"). */
const ftypBytes = (brand: string): number[] => [
  0x00,
  0x00,
  0x00,
  0x20, // box size
  ...ascii('ftyp'),
  ...ascii(brand), // major brand at offset 8
  0x00,
  0x00,
  0x00,
  0x00, // minor version
]

// video/mp4 → isom brand; video/quicktime → "qt  " brand; audio/mp4 → "M4A "
const MP4_VIDEO = ftypBytes('isom')
const MOV_VIDEO = ftypBytes('qt  ')
const MP4_AUDIO = ftypBytes('M4A ')
// webm/mkv EBML header 1A 45 DF A3
const WEBM = [0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
// Ogg container "OggS"
const OGG = [...ascii('OggS'), 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
// MP3 with an ID3v2 tag, and the frame-sync variants
const MP3_ID3 = [...ascii('ID3'), 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
const MP3_FFFB = [0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
const MP3_FFF3 = [0xff, 0xf3, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
const MP3_FFF2 = [0xff, 0xf2, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
// WAV: RIFF????WAVE
const WAV = [...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WAVE')]

/** A media File starting with `sig`, zero-padded up to `bytes`, declared `mime`. */
const mediaFile = (sig: number[], mime: string, name: string, bytes = sig.length): File => {
  const buf = new Uint8Array(Math.max(bytes, sig.length))
  buf.set(Uint8Array.from(sig))
  return new File([buf], name, { type: mime })
}

beforeEach(() => {
  mocks.fileFindFirst.mockReset().mockResolvedValue(null)
  mocks.fileAggregate.mockReset().mockResolvedValue({ _sum: { fileSize: 0n } })
  mocks.limitFindUnique.mockReset().mockResolvedValue(null)
  mocks.userUpdate.mockReset().mockResolvedValue({})
  mocks.txFileCreate.mockReset().mockResolvedValue(createdRow())
  mocks.txFileCount.mockReset().mockResolvedValue(0)
  mocks.txUserUpdate.mockReset().mockResolvedValue({})
  mocks.storagePut.mockReset().mockResolvedValue(undefined)
  mocks.storageDelete.mockReset().mockResolvedValue(undefined)
  mocks.getSession.mockReset().mockResolvedValue({ user: { id: USER_ID } })
  mocks.getActiveWorkspaceForUser.mockReset().mockResolvedValue(null)
  mocks.workspaceFindFirst.mockReset().mockResolvedValue(null)
  mocks.txQueryRaw.mockReset().mockResolvedValue([{ id: 'workspace' }])
})

// ── validateUpload: the new kinds ────────────────────────────────────────────

describe('validateUpload — icon kind (1MB, image MIME)', () => {
  it('accepts a 1MB png', () => {
    expect(validateUpload('icon', 1 * MB, 'image/png')).toBeNull()
  })

  it('rejects anything over 1MB', () => {
    expect(validateUpload('icon', 1 * MB + 1, 'image/png')).toMatchObject({ status: 400 })
  })

  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])('accepts %s', (mime) => {
    expect(validateUpload('icon', 100, mime)).toBeNull()
  })

  it('rejects non-image MIME (pdf)', () => {
    expect(validateUpload('icon', 100, 'application/pdf')).toMatchObject({ status: 400 })
  })

  it('rejects svg (not in the image whitelist)', () => {
    expect(validateUpload('icon', 100, 'image/svg+xml')).toMatchObject({ status: 400 })
  })
})

describe('validateUpload — cover kind (10MB, image MIME)', () => {
  it('accepts a 10MB jpeg', () => {
    expect(validateUpload('cover', 10 * MB, 'image/jpeg')).toBeNull()
  })

  it('rejects anything over 10MB', () => {
    expect(validateUpload('cover', 10 * MB + 1, 'image/jpeg')).toMatchObject({ status: 400 })
  })

  it('rejects non-image MIME (zip)', () => {
    expect(validateUpload('cover', 100, 'application/zip')).toMatchObject({ status: 400 })
  })
})

// ── sniffImageMime: the four whitelist signatures ─────────────────────────────

describe('sniffImageMime', () => {
  it.each([
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]],
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]],
    ['image/webp', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ] as const)('detects %s from its signature', (mime, bytes) => {
    expect(sniffImageMime(Uint8Array.from(bytes))).toBe(mime)
  })

  it('returns null for unknown bytes (HTML, empty, truncated)', () => {
    expect(sniffImageMime(Uint8Array.from(Buffer.from('<html></html>', 'utf8')))).toBeNull()
    expect(sniffImageMime(new Uint8Array(0))).toBeNull()
    expect(sniffImageMime(Uint8Array.from([0x89, 0x50]))).toBeNull()
  })

  it('returns null for RIFF that is not WEBP (e.g. WAV)', () => {
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
    expect(sniffImageMime(wav)).toBeNull()
  })
})

// ── POST /api/files/upload?kind=icon|cover ───────────────────────────────────

describe('POST /api/files/upload — icon/cover kinds (public-by-id, no quota)', () => {
  it.each(['icon', 'cover'] as const)(
    'kind=%s creates a PUBLIC file with workspaceId null and returns imageUrl',
    async (kind) => {
      const res = await POST(makeUploadRequest(kind, pngFile()))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { file: { id: string }; imageUrl?: string }
      expect(body.imageUrl).toBe('/api/files/f-new-1')
      expect(mocks.txFileCreate).toHaveBeenCalledTimes(1)
      const createArgs = mocks.txFileCreate.mock.calls[0]?.[0] as {
        data: Record<string, unknown>
      }
      expect(createArgs.data).toMatchObject({ isPublic: true, workspaceId: null })
    },
  )

  it.each(['icon', 'cover'] as const)(
    'kind=%s is quota-exempt (no workspace limit lookup) and never touches User.image',
    async (kind) => {
      const res = await POST(makeUploadRequest(kind, pngFile()))
      expect(res.status).toBe(200)
      expect(mocks.limitFindUnique).not.toHaveBeenCalled()
      expect(mocks.fileAggregate).not.toHaveBeenCalled()
      expect(mocks.txUserUpdate).not.toHaveBeenCalled()
      expect(mocks.userUpdate).not.toHaveBeenCalled()
    },
  )

  it('kind=icon rejects a file over 1MB with 400', async () => {
    const res = await POST(makeUploadRequest('icon', pngFile(MB + 1)))
    expect(res.status).toBe(400)
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('kind=cover rejects a non-image MIME with 400', async () => {
    const file = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' })
    const res = await POST(makeUploadRequest('cover', file))
    expect(res.status).toBe(400)
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('still rejects an unknown kind with 400', async () => {
    const res = await POST(makeUploadRequest('banner', pngFile()))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid kind')
  })

  it('dedup hit (existing row) for icon does NOT update User.image and still answers with imageUrl', async () => {
    mocks.fileFindFirst.mockResolvedValue(createdRow({ id: 'f-existing-1' }))
    const res = await POST(makeUploadRequest('icon', pngFile()))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { imageUrl?: string }
    expect(body.imageUrl).toBe('/api/files/f-existing-1')
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('avatar keeps its User.image side-effect (regression pin)', async () => {
    const res = await POST(makeUploadRequest('avatar', pngFile()))
    expect(res.status).toBe(200)
    expect(mocks.txUserUpdate).toHaveBeenCalledTimes(1)
  })
})

// ── Magic-byte validation for the public image kinds ─────────────────────────

describe('POST /api/files/upload — magic-byte validation (avatar/icon/cover)', () => {
  it.each(['avatar', 'icon', 'cover'] as const)(
    'kind=%s rejects an HTML payload declared image/png with 400',
    async (kind) => {
      const html = new File(
        [Buffer.from('<html><script>alert(1)</script></html>', 'utf8')],
        'evil.png',
        { type: 'image/png' },
      )
      const res = await POST(makeUploadRequest(kind, html))
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('Файл не является изображением')
      expect(mocks.storagePut).not.toHaveBeenCalled()
      expect(mocks.txFileCreate).not.toHaveBeenCalled()
    },
  )

  it('rejects a real png declared as image/jpeg (declared/sniffed mismatch)', async () => {
    const lying = new File([new Uint8Array(PNG_1X1)], 'pic.jpg', { type: 'image/jpeg' })
    const res = await POST(makeUploadRequest('icon', lying))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Файл не является изображением')
  })

  it('accepts a real 1×1 png buffer for kind=icon', async () => {
    const res = await POST(makeUploadRequest('icon', pngFile()))
    expect(res.status).toBe(200)
    expect(mocks.txFileCreate).toHaveBeenCalledTimes(1)
  })

  it('does NOT sniff attachments (a zip declared application/zip passes MIME-only)', async () => {
    mocks.getActiveWorkspaceForUser.mockResolvedValue({ id: 'ws-1' })
    mocks.limitFindUnique.mockResolvedValue({ maxFileBytes: BigInt(100 * MB) })
    const zip = new File([Buffer.from('not-actually-zip-bytes', 'utf8')], 'a.zip', {
      type: 'application/zip',
    })
    const res = await POST(makeUploadRequest('attachment', zip))
    expect(res.status).toBe(200)
  })
})

// ── validateUpload: the attachment kind (no MIME whitelist) ──────────────────

describe('validateUpload — attachment kind (any MIME, 50MB)', () => {
  it.each([
    'application/octet-stream',
    'text/html',
    'application/json',
    'application/x-msdownload',
    'video/mp4',
  ])('accepts %s (attachments have no MIME whitelist)', (mime) => {
    expect(validateUpload('attachment', 100, mime)).toBeNull()
  })

  it('still enforces the 50MB cap', () => {
    expect(validateUpload('attachment', 50 * MB + 1, 'text/plain')).toMatchObject({ status: 400 })
  })

  it('still rejects an empty file', () => {
    expect(validateUpload('attachment', 0, 'text/plain')).toMatchObject({ status: 400 })
  })
})

// ── isInlineSafeMime: the serving-side counterpart of "any MIME uploads" ─────

describe('isInlineSafeMime', () => {
  it.each([
    'image/png',
    'image/webp',
    'video/mp4',
    'audio/mpeg',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
  ])('%s is inline-safe', (mime) => {
    expect(isInlineSafeMime(mime)).toBe(true)
  })

  it.each([
    'text/html',
    'image/svg+xml',
    'application/xhtml+xml',
    'application/zip',
    'application/octet-stream',
    'application/javascript',
    '',
  ])('%s must download', (mime) => {
    expect(isInlineSafeMime(mime)).toBe(false)
  })
})

// ── validateUpload: the media kind (Phase 9B) ────────────────────────────────

describe('validateUpload — media kind (200MB, video/audio MIME)', () => {
  it('accepts a file at the 200MB cap', () => {
    expect(validateUpload('media', 200 * MB, 'video/mp4')).toBeNull()
  })

  it('rejects anything over 200MB', () => {
    expect(validateUpload('media', 200 * MB + 1, 'video/mp4')).toMatchObject({ status: 400 })
  })

  it.each([
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/mp4',
  ])('accepts %s', (mime) => {
    expect(validateUpload('media', 100, mime)).toBeNull()
  })

  it('rejects a non-media MIME (pdf)', () => {
    expect(validateUpload('media', 100, 'application/pdf')).toMatchObject({ status: 400 })
  })

  it('rejects an image MIME (image stays attachment, not media)', () => {
    expect(validateUpload('media', 100, 'image/png')).toMatchObject({ status: 400 })
  })
})

// ── sniffMediaMime: container signatures → family ('video' | 'audio' | null) ──

describe('sniffMediaMime', () => {
  it('detects video from an mp4 ftyp box (isom brand)', () => {
    expect(sniffMediaMime(Uint8Array.from(MP4_VIDEO))).toBe('video')
  })

  it('detects video from a quicktime ftyp box ("qt  " brand)', () => {
    expect(sniffMediaMime(Uint8Array.from(MOV_VIDEO))).toBe('video')
  })

  it('detects audio from an m4a ftyp box ("M4A " brand)', () => {
    expect(sniffMediaMime(Uint8Array.from(MP4_AUDIO))).toBe('audio')
  })

  it('detects a webm/mkv EBML header as video', () => {
    expect(sniffMediaMime(Uint8Array.from(WEBM))).toBe('video')
  })

  it('detects an OggS container as video (family-agnostic container)', () => {
    // Ogg carries both; the route family-matcher treats it as compatible with
    // both video/ogg and audio/ogg.
    expect(sniffMediaMime(Uint8Array.from(OGG))).not.toBeNull()
  })

  it.each([
    ['ID3', MP3_ID3],
    ['FFFB frame-sync', MP3_FFFB],
    ['FFF3 frame-sync', MP3_FFF3],
    ['FFF2 frame-sync', MP3_FFF2],
  ] as const)('detects mp3 (%s) as audio', (_label, sig) => {
    expect(sniffMediaMime(Uint8Array.from(sig))).toBe('audio')
  })

  it('detects RIFF/WAVE as audio', () => {
    expect(sniffMediaMime(Uint8Array.from(WAV))).toBe('audio')
  })

  it('returns null for unknown bytes (HTML, empty, truncated, a bare PNG)', () => {
    expect(sniffMediaMime(Uint8Array.from(Buffer.from('<html></html>', 'utf8')))).toBeNull()
    expect(sniffMediaMime(new Uint8Array(0))).toBeNull()
    expect(sniffMediaMime(Uint8Array.from([0x1a, 0x45]))).toBeNull()
    expect(sniffMediaMime(Uint8Array.from(PNG_1X1))).toBeNull()
  })

  it('returns null for RIFF that is not WAVE (e.g. WEBP)', () => {
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(sniffMediaMime(webp)).toBeNull()
  })
})

// ── POST /api/files/upload?kind=media (quota-counted, NOT public) ─────────────

describe('POST /api/files/upload — media kind (workspace-quota, auth-gated)', () => {
  const withActiveWorkspace = () => {
    mocks.getActiveWorkspaceForUser.mockResolvedValue({ id: 'ws-1' })
    mocks.limitFindUnique.mockResolvedValue({ maxFileBytes: BigInt(500 * MB) })
  }

  it.each([
    ['video/mp4', MP4_VIDEO, 'clip.mp4'],
    ['video/quicktime', MOV_VIDEO, 'clip.mov'],
    ['video/webm', WEBM, 'clip.webm'],
    ['video/ogg', OGG, 'clip.ogv'],
    ['audio/mp4', MP4_AUDIO, 'song.m4a'],
    ['audio/mpeg', MP3_ID3, 'song.mp3'],
    ['audio/mpeg', MP3_FFFB, 'song2.mp3'],
    ['audio/wav', WAV, 'song.wav'],
    ['audio/ogg', OGG, 'song.ogg'],
    ['audio/webm', WEBM, 'song.weba'],
  ] as const)('accepts %s with a matching container signature', async (mime, sig, name) => {
    withActiveWorkspace()
    const res = await POST(makeUploadRequest('media', mediaFile(sig, mime, name)))
    expect(res.status).toBe(200)
    expect(mocks.txFileCreate).toHaveBeenCalledTimes(1)
    const createArgs = mocks.txFileCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(createArgs.data).toMatchObject({ isPublic: false, workspaceId: 'ws-1' })
  })

  it('rejects an HTML payload declared video/mp4 with 400 (family mismatch)', async () => {
    withActiveWorkspace()
    const html = new File([Buffer.from('<html><body>nope</body></html>', 'utf8')], 'evil.mp4', {
      type: 'video/mp4',
    })
    const res = await POST(makeUploadRequest('media', html))
    expect(res.status).toBe(400)
    expect(mocks.storagePut).not.toHaveBeenCalled()
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('rejects audio bytes declared as video (family mismatch: mp3 as video/mp4)', async () => {
    withActiveWorkspace()
    const res = await POST(makeUploadRequest('media', mediaFile(MP3_ID3, 'video/mp4', 'lie.mp4')))
    expect(res.status).toBe(400)
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('rejects an oversized media file (>200MB) with 400', async () => {
    withActiveWorkspace()
    const big = mediaFile(MP4_VIDEO, 'video/mp4', 'big.mp4', 200 * MB + 1)
    const res = await POST(makeUploadRequest('media', big))
    expect(res.status).toBe(400)
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('goes through the workspace quota aggregate and 413s when the cap is exceeded', async () => {
    mocks.getActiveWorkspaceForUser.mockResolvedValue({ id: 'ws-1' })
    mocks.fileAggregate.mockResolvedValue({ _sum: { fileSize: BigInt(100 * MB) } })
    mocks.limitFindUnique.mockResolvedValue({ maxFileBytes: BigInt(100 * MB) })
    const res = await POST(
      makeUploadRequest('media', mediaFile(MP4_VIDEO, 'video/mp4', 'clip.mp4')),
    )
    expect(res.status).toBe(413)
    expect(mocks.fileAggregate).toHaveBeenCalledTimes(1)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('WORKSPACE_STORAGE_LIMIT')
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('rechecks quota under the workspace lock before storing concurrent bytes', async () => {
    mocks.getActiveWorkspaceForUser.mockResolvedValue({ id: 'ws-1' })
    mocks.fileAggregate
      .mockResolvedValueOnce({ _sum: { fileSize: 0n } })
      .mockResolvedValueOnce({ _sum: { fileSize: BigInt(100 * MB) } })
    mocks.limitFindUnique.mockResolvedValue({ maxFileBytes: BigInt(100 * MB) })

    const res = await POST(
      makeUploadRequest('media', mediaFile(MP4_VIDEO, 'video/mp4', 'clip.mp4')),
    )

    expect(res.status).toBe(413)
    expect(mocks.txQueryRaw).toHaveBeenCalledOnce()
    expect(mocks.storagePut).not.toHaveBeenCalled()
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('removes an unreferenced object after a workspace transaction failure', async () => {
    mocks.getActiveWorkspaceForUser.mockResolvedValue({ id: 'ws-1' })
    mocks.limitFindUnique.mockResolvedValue({ maxFileBytes: BigInt(100 * MB) })
    mocks.txFileCreate.mockRejectedValueOnce(new Error('commit failed'))

    await expect(
      POST(makeUploadRequest('media', mediaFile(MP4_VIDEO, 'video/mp4', 'clip.mp4'))),
    ).rejects.toThrow('commit failed')

    expect(mocks.storagePut).toHaveBeenCalledOnce()
    expect(mocks.txFileCount).toHaveBeenCalledOnce()
    expect(mocks.storageDelete).toHaveBeenCalledOnce()
    expect(mocks.txQueryRaw).toHaveBeenCalledTimes(2)
  })

  it('400s when there is no active workspace', async () => {
    mocks.getActiveWorkspaceForUser.mockResolvedValue(null)
    const res = await POST(
      makeUploadRequest('media', mediaFile(MP4_VIDEO, 'video/mp4', 'clip.mp4')),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('No active workspace')
  })
})

describe('POST /api/files/upload — explicit workspaceId (chat context pinning)', () => {
  const WS_ID = '44444444-4444-4444-8444-444444444444'
  const zip = new File([new Uint8Array(64)], 'a.zip', { type: 'application/zip' })

  it('pins the file to the requested workspace when the user is a member', async () => {
    mocks.workspaceFindFirst.mockResolvedValue({ id: WS_ID })
    mocks.limitFindUnique.mockResolvedValue({ maxFileBytes: BigInt(100 * MB) })
    mocks.txFileCreate.mockResolvedValue(createdRow({ isPublic: false, name: 'a.zip' }))

    const res = await POST(makeUploadRequest('attachment', zip, WS_ID))
    expect(res.status).toBe(200)
    // Membership was checked against the REQUESTED workspace…
    expect(mocks.workspaceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: WS_ID,
          members: { some: { userId: USER_ID } },
          blockedUsers: { none: { userId: USER_ID } },
        }),
      }),
    )
    // …the active-workspace fallback never ran, and the row landed there.
    expect(mocks.getActiveWorkspaceForUser).not.toHaveBeenCalled()
    expect(mocks.txFileCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: WS_ID }) }),
    )
    expect(mocks.fileAggregate).toHaveBeenCalledTimes(2)
    expect(mocks.fileAggregate).toHaveBeenLastCalledWith({
      where: {
        workspaceId: WS_ID,
        OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gt: expect.any(Date) } }],
      },
      _sum: { fileSize: true },
    })
    expect(mocks.txQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fileAggregate.mock.invocationCallOrder[1]!,
    )
    expect(mocks.fileAggregate.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.txFileCreate.mock.invocationCallOrder[0]!,
    )
  })

  it('403s when the user is not a member of the requested workspace', async () => {
    mocks.workspaceFindFirst.mockResolvedValue(null)
    const res = await POST(makeUploadRequest('attachment', zip, WS_ID))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Нет доступа к пространству')
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('400s on a malformed workspaceId', async () => {
    const res = await POST(makeUploadRequest('attachment', zip, 'not-a-uuid'))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid workspaceId')
    expect(mocks.workspaceFindFirst).not.toHaveBeenCalled()
  })

  it('falls back to the active workspace when no workspaceId is passed', async () => {
    mocks.getActiveWorkspaceForUser.mockResolvedValue({ id: 'ws-active' })
    mocks.limitFindUnique.mockResolvedValue({ maxFileBytes: BigInt(100 * MB) })
    mocks.txFileCreate.mockResolvedValue(createdRow({ isPublic: false, name: 'a.zip' }))

    const res = await POST(makeUploadRequest('attachment', zip))
    expect(res.status).toBe(200)
    expect(mocks.workspaceFindFirst).not.toHaveBeenCalled()
    expect(mocks.txFileCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: 'ws-active' }) }),
    )
  })
})
