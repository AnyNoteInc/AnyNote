import { signAgentsServiceToken, type AgentsServiceAuth } from './agents-token'

export type { AgentsServiceAuth }
export type ProviderConnectionInput = Record<string, string>

export type LlmValidationResult = { ok: boolean; error: string | null }
export type EmbeddingValidationResult = { ok: boolean; vectorSize: number | null; error: string | null }
export type McpValidationResult = { ok: boolean; tools: string[]; error: string | null }

function agentsBaseUrl(): string {
  return process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
}

async function postValidate<T extends { ok: boolean; error: string | null }>(
  path: string,
  body: unknown,
  auth: AgentsServiceAuth,
  onUnreachable: T,
): Promise<T> {
  const token = await signAgentsServiceToken(auth)
  try {
    const res = await fetch(`${agentsBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ...onUnreachable, error: `Validation service error (HTTP ${res.status})` }
    return (await res.json()) as T
  } catch {
    return onUnreachable
  }
}

export function validateLlm(
  input: { provider: string; name: string; connection: ProviderConnectionInput },
  auth: AgentsServiceAuth,
): Promise<LlmValidationResult> {
  return postValidate<LlmValidationResult>('/validation/llm', input, auth, {
    ok: false,
    error: 'Validation service unavailable',
  })
}

export function validateEmbedding(
  input: { provider: string; modelSlug: string; connection: ProviderConnectionInput },
  auth: AgentsServiceAuth,
): Promise<EmbeddingValidationResult> {
  return postValidate<EmbeddingValidationResult>('/validation/embedding', input, auth, {
    ok: false,
    vectorSize: null,
    error: 'Validation service unavailable',
  })
}

export function validateMcp(
  input: { url: string; transport: 'HTTP_JSONRPC' | 'SSE'; headers: ProviderConnectionInput; verify: boolean },
  auth: AgentsServiceAuth,
): Promise<McpValidationResult> {
  return postValidate<McpValidationResult>(
    '/validation/mcp',
    // name is required by McpServerSchema but ignored by the validation use-case
    { name: 'probe', ...input, tools: [] },
    auth,
    { ok: false, tools: [], error: 'Validation service unavailable' },
  )
}
