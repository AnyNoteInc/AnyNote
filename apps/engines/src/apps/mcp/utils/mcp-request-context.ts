import type { AuthedRequest } from '../../api/auth/auth-context.js'

export type { Context } from '@rekog/mcp-nest'

type HeaderValue = string | string[] | undefined
type HeaderMap = Record<string, HeaderValue>

export type McpRequestWithContext = AuthedRequest & {
  headers: HeaderMap
  body?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function normalizeMcpRequestBody(body: unknown): void {
  if (!isRecord(body) || body.method !== 'tools/call') return
  const params = body.params
  if (!isRecord(params)) return
  if (params.arguments === undefined && params.args !== undefined) {
    params.arguments = params.args
  }
}
