import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/lib/get-session'
import { renderPlantumlSvg } from '@/server/plantuml/render'
import {
  PlantumlTimeoutError,
  PlantumlUnreachableError,
  PlantumlUpstreamError,
} from '@/server/plantuml/errors'

export const runtime = 'nodejs'

const bodySchema = z.object({ source: z.string().min(1).max(20_000) })

export async function POST(req: Request) {
  // Auth-gate so the proxy can't be used as an open SSRF relay.
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let source: string
  try {
    source = bodySchema.parse(await req.json()).source
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const svg = await renderPlantumlSvg(source)
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
