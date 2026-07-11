import crypto from 'node:crypto'

export function buildEnginesMcpHeaders(args: {
  userId: string
  ts: number
  /** Bound page id for PAGE chats. HMAC-covered (`userId:ts:boundPageId`) and
   *  sent as `x-agents-bound-page`; engines' AgentsInternalAuthGuard verifies it
   *  and every page-write MCP tool rejects a different pageId — the engines half
   *  of the hard page binding (defense in depth behind the agents tool_runner). */
  boundPageId?: string | null
}): Record<string, string> {
  const secret = process.env.AGENTS_TO_ENGINES_SECRET
  if (!secret) throw new Error('AGENTS_TO_ENGINES_SECRET is not configured')

  const message = args.boundPageId
    ? `${args.userId}:${args.ts}:${args.boundPageId}`
    : `${args.userId}:${args.ts}`
  const sig = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(message)
    .digest('base64')

  return {
    authorization: `Bearer ${sig}`,
    'x-agents-user': args.userId,
    'x-agents-timestamp': String(args.ts),
    ...(args.boundPageId ? { 'x-agents-bound-page': args.boundPageId } : {}),
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
}
