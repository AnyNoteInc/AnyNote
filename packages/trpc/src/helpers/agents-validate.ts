export type ProviderConnectionInput = Record<string, string>

export type LlmValidationResult = { ok: boolean; error: string | null }
export type EmbeddingValidationResult = { ok: boolean; vectorSize: number | null; error: string | null }
export type McpValidationResult = { ok: boolean; tools: string[]; error: string | null }

function agentsBaseUrl(): string {
  return process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
}

async function postValidate<T extends { ok: boolean }>(
  path: string,
  body: unknown,
  onUnreachable: T,
): Promise<T> {
  const ctl = new AbortController()
  const timeout = setTimeout(() => ctl.abort(), 15_000)
  try {
    const res = await fetch(`${agentsBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    if (!res.ok) return onUnreachable
    return (await res.json()) as T
  } catch {
    return onUnreachable
  } finally {
    clearTimeout(timeout)
  }
}

export function validateLlm(input: {
  provider: string
  name: string
  connection: ProviderConnectionInput
}): Promise<LlmValidationResult> {
  return postValidate<LlmValidationResult>('/validation/llm', input, {
    ok: false,
    error: 'Validation service unavailable',
  })
}

export function validateEmbedding(input: {
  provider: string
  modelSlug: string
  connection: ProviderConnectionInput
}): Promise<EmbeddingValidationResult> {
  return postValidate<EmbeddingValidationResult>('/validation/embedding', input, {
    ok: false,
    vectorSize: null,
    error: 'Validation service unavailable',
  })
}

export function validateMcp(input: {
  url: string
  transport: 'HTTP_JSONRPC' | 'SSE'
  headers: ProviderConnectionInput
  verify: boolean
}): Promise<McpValidationResult> {
  return postValidate<McpValidationResult>(
    '/validation/mcp',
    { name: 'probe', ...input, tools: [] },
    { ok: false, tools: [], error: 'Validation service unavailable' },
  )
}
