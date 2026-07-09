import { describe, expect, it } from 'vitest'

import { rewriteHtmlForArchive } from '@/server/page-export/bulk/rewrite-archive-html'

const FID = '11111111-1111-4111-9111-111111111111'
const PID = '22222222-2222-4222-9222-222222222222'

const ctx = {
  fromDir: 'Proj',
  baseUrl: 'https://app.test',
  assetPathFor: (id: string) => (id === FID ? `assets/${FID}.png` : null),
  pagePathFor: (id: string) => (id === PID ? 'Proj/Target.md' : null),
}

describe('rewriteHtmlForArchive', () => {
  it('rewrites bundled image srcs to relative asset paths and records fileIds', () => {
    const { html, fileIds } = rewriteHtmlForArchive(`<img src="/api/files/${FID}">`, ctx)
    expect(html).toContain(`src="../assets/${FID}.png"`)
    expect(fileIds).toEqual([FID])
  })

  it('rewrites included page links to relative paths and others to absolute', () => {
    const { html } = rewriteHtmlForArchive(
      `<a href="/pages/${PID}">in</a><a href="/pages/33333333-3333-4333-9333-333333333333">out</a>`,
      ctx,
    )
    expect(html).toContain('href="Target.md"')
    expect(html).toContain('href="https://app.test/pages/33333333-3333-4333-9333-333333333333"')
  })

  it('makes file-attachment links absolute', () => {
    const { html } = rewriteHtmlForArchive(`<a href="/api/files/${FID}/x">f</a>`, ctx)
    expect(html).toContain('href="https://app.test/api/files/')
  })
})
