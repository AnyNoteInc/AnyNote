import type { ColorMode, RenderResult } from '@repo/diagram-board/render-types'

/**
 * Render PlantUML source to SVG by POSTing to the same-origin proxy route
 * (apps/web /api/plantuml/render), which forwards to the private plantuml-server.
 * `id`/`mode` satisfy the DiagramRenderer contract but are unused — the server
 * renders the source as-is. Empty source short-circuits with no request.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function renderPlantuml(_id: string, source: string, _mode: ColorMode): Promise<RenderResult> {
  if (!source.trim()) return { ok: true, svg: '' }
  try {
    const res = await fetch('/api/plantuml/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    })
    return (await res.json()) as RenderResult
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
