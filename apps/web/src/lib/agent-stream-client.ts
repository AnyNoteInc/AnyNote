export type ServerEvent =
  | { type: 'router_decision'; kind: 'trivial' | 'complex'; reason: string }
  | { type: 'plan_step'; id: string; title: string; position: number; status: string }
  | { type: 'step_started'; step_id: string }
  | { type: 'step_completed'; step_id: string; result_summary: string }
  | { type: 'token'; text: string; step_id: string | null }
  | {
      type: 'tool_status'
      id: string
      tool: string
      state: 'running' | 'done' | 'error'
      title: string
      detail?: string
      duration_ms?: number
    }
  | {
      type: 'confirmation_required'
      confirmation_id: string
      tool: string
      summary: string
      args_preview: unknown
    }
  | {
      type: 'memory_write_proposed'
      scope: 'workspace' | 'user'
      key: string
      content_preview: string
    }
  | {
      type: 'critic_verdict'
      verdict: 'approve' | 'revise' | 'reject'
      feedback: string
      revision_count: number
    }
  | {
      type: 'citation'
      page_id: string
      workspace_id: string
      block_number: number
      title: string
      quote?: string
    }
  | {
      type: 'usage'
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      cost_usd?: number
    }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string; recoverable: boolean }

export async function* consumeAgentStream(
  response: Response,
): AsyncGenerator<ServerEvent> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const evChunk of events) {
      const dataLine = evChunk.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      try {
        yield JSON.parse(dataLine.slice('data:'.length).trim()) as ServerEvent
      } catch {
        // ignore malformed event; SSE ping lines start with `: `
      }
    }
  }
}
