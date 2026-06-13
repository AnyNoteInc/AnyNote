import { type NextRequest, type NextResponse } from 'next/server'

import { handlePreview } from './handler'

// Next.js only permits a route file to export `runtime` + the HTTP-method
// handlers. The SSRF-guarded implementation + its test hooks live in
// `./handler.ts`; this file is the thin route surface.
export const runtime = 'nodejs'

/** Next route handler — delegates to `handlePreview` with the live fetch/lookup. */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handlePreview(req)
}
