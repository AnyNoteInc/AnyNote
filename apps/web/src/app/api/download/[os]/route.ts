import { Readable } from 'node:stream'

import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'

import type { DesktopOS } from '@/lib/download-links'

export const runtime = 'nodejs'

// Desktop installers are uploaded to S3 under `desktop/` by the Desktop CI
// workflow (electron-builder → `aws s3 cp`). The repo/releases are private, so
// we proxy the bytes through the app for anonymous visitors — same shape as
// `/api/files/[id]`. Filenames/keys match electron-builder.yml artifactName.
const ASSET: Record<DesktopOS, { key: string; filename: string; contentType: string }> = {
  mac: {
    key: 'desktop/AnyNote.dmg',
    filename: 'AnyNote.dmg',
    contentType: 'application/x-apple-diskimage',
  },
  win: {
    key: 'desktop/AnyNote-Setup.exe',
    filename: 'AnyNote-Setup.exe',
    contentType: 'application/vnd.microsoft.portable-executable',
  },
  linux: {
    key: 'desktop/AnyNote.AppImage',
    filename: 'AnyNote.AppImage',
    contentType: 'application/x-executable',
  },
}

function isDesktopOS(value: string): value is DesktopOS {
  return value === 'mac' || value === 'win' || value === 'linux'
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ os: string }> }) {
  const { os } = await params
  if (!isDesktopOS(os)) {
    return new Response('Not found', { status: 404 })
  }

  const asset = ASSET[os]

  let body: Readable
  try {
    body = (await storage.get(asset.key)) as Readable
  } catch {
    // Object not uploaded yet (e.g. before the first Desktop CI run).
    return new Response('Not found', { status: 404 })
  }

  const stream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>
  const filenameStar = encodeURIComponent(asset.filename)

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': asset.contentType,
      'Content-Disposition': `attachment; filename="${asset.filename}"; filename*=UTF-8''${filenameStar}`,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
