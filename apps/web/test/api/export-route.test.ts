import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { GET } from '../../src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route'

const PAGE_ID = '11111111-1111-4111-8111-111111111111'
const WS_ID = '22222222-2222-4222-8222-222222222222'

function makeRequest(format: string): NextRequest {
  const url = `http://localhost:3000/api/workspaces/${WS_ID}/pages/${PAGE_ID}/export/${format}`
  return new Request(url) as unknown as NextRequest
}

function callRoute(format: string) {
  return GET(makeRequest(format), {
    params: Promise.resolve({ workspaceId: WS_ID, pageId: PAGE_ID, format }),
  })
}

describe('GET /api/workspaces/:ws/pages/:p/export/:format (legacy redirect)', () => {
  it('redirects 307 to the neutral export URL for a valid request', async () => {
    const res = await callRoute('html')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain(`/api/pages/${PAGE_ID}/export/html`)
  })

  it('preserves the requested format in the redirect target', async () => {
    const res = await callRoute('pdf')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain(`/api/pages/${PAGE_ID}/export/pdf`)
  })

  it('returns 404 for an invalid format', async () => {
    const res = await GET(makeRequest('zip'), {
      params: Promise.resolve({ workspaceId: WS_ID, pageId: PAGE_ID, format: 'zip' }),
    })
    expect(res.status).toBe(404)
  })
})
