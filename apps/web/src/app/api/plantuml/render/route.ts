import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@repo/db'

import { getSession } from '@/lib/get-session'
import { resolveShareAccess } from '@/lib/share-access'
import { renderPlantumlSvg } from '@/server/plantuml/render'
import {
  PlantumlTimeoutError,
  PlantumlUnreachableError,
  PlantumlUpstreamError,
} from '@/server/plantuml/errors'

export const runtime = 'nodejs'

const bodySchema = z.object({
  source: z.string().min(1).max(20_000),
  shareId: z.string().min(1).optional(),
})

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  // Auth-gate so the proxy can't be used as a public PlantUML relay. A normal
  // app view uses the session cookie; public share views prove access with the
  // share id that already gates /s/[shareId] and share-scoped Yjs tokens.
  const session = await getSession()
  if (!session) {
    if (!body.shareId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
    const resolved = await resolveShareAccess(prisma, body.shareId, null)
    if (resolved.kind === 'not_found' || resolved.kind === 'unavailable') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const svg = await renderPlantumlSvg(body.source)
    return NextResponse.json({ ok: true, svg }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    if (err instanceof PlantumlTimeoutError) {
      return NextResponse.json({ ok: false, error: 'PlantUML render timed out' }, { status: 504 })
    }
    if (err instanceof PlantumlUpstreamError || err instanceof PlantumlUnreachableError) {
      return NextResponse.json({ ok: false, error: 'PlantUML server error' }, { status: 502 })
    }
    return NextResponse.json({ ok: false, error: 'Render failed' }, { status: 500 })
  }
}
