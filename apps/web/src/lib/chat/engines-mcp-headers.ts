import crypto from 'node:crypto'

export function buildEnginesMcpHeaders(args: {
  userId: string
  workspaceId: string
  ts: number
}): Record<string, string> {
  const secret = process.env.AGENTS_TO_ENGINES_SECRET
  if (!secret) throw new Error('AGENTS_TO_ENGINES_SECRET is not configured')

  const sig = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${args.userId}:${args.workspaceId}:${args.ts}`)
    .digest('base64')

  return {
    authorization: `Bearer ${sig}`,
    'x-agents-user': args.userId,
    'x-agents-workspace': args.workspaceId,
    'x-agents-timestamp': String(args.ts),
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
}
