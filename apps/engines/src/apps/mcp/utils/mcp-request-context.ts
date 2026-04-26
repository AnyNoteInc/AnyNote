import { UnauthorizedException } from '@nestjs/common'
import { z } from 'zod'

const McpRequestContextSchema = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})

type HeaderValue = string | string[] | undefined
type HeaderMap = Record<string, HeaderValue>

export type McpRequestContext = z.infer<typeof McpRequestContextSchema>

export type McpRequestWithContext = {
  headers: HeaderMap
  body?: unknown
  mcpContext?: McpRequestContext
}

function getHeader(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
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

export function readMcpRequestContext(headers: HeaderMap): McpRequestContext {
  const userId = getHeader(headers, 'x-user-id')
  if (!userId) throw new UnauthorizedException('Unauthorized: missing X-User-Id header')

  const workspaceId = getHeader(headers, 'x-workspace-id')
  if (!workspaceId) {
    throw new UnauthorizedException('Unauthorized: missing x-Workspace-Id header')
  }

  const parsed = McpRequestContextSchema.safeParse({ userId, workspaceId })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const headerName = issue?.path[0] === 'workspaceId' ? 'x-Workspace-Id' : 'X-User-Id'
    throw new UnauthorizedException(`Unauthorized: invalid ${headerName} header`)
  }

  return parsed.data
}

export function getMcpRequestContext(req?: McpRequestWithContext): McpRequestContext {
  if (!req) throw new UnauthorizedException('Unauthorized: MCP request context is unavailable')

  if (!req.mcpContext) {
    req.mcpContext = readMcpRequestContext(req.headers)
  }

  return req.mcpContext
}
