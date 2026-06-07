import { z } from 'zod'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const ParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid(),
  format: z.enum(['pdf', 'html', 'md']),
})

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string; pageId: string; format: string }> },
) {
  const parsed = ParamsSchema.safeParse(await ctx.params)
  if (!parsed.success) return new Response(null, { status: 404 })
  const { pageId, format } = parsed.data
  return Response.redirect(new URL(`/api/pages/${pageId}/export/${format}`, req.url), 307)
}
