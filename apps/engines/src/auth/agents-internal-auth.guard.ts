import crypto from 'node:crypto'
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'

const SKEW_SECONDS = 60

function safeEqualB64(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'base64')
  const bb = Buffer.from(b, 'base64')
  if (ba.length === 0 || ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function pick(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

@Injectable()
export class AgentsInternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>
    }>()
    const headers = req.headers
    const auth = pick(headers['authorization'])
    const userId = pick(headers['x-agents-user'])
    const workspaceId = pick(headers['x-agents-workspace'])
    const tsRaw = pick(headers['x-agents-timestamp'])

    if (!auth?.startsWith('Bearer ') || !userId || !workspaceId || !tsRaw) {
      throw new UnauthorizedException('missing agents internal auth headers')
    }

    const ts = Number(tsRaw)
    if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > SKEW_SECONDS) {
      throw new UnauthorizedException('timestamp outside skew window')
    }

    const secret = process.env.AGENTS_TO_ENGINES_SECRET
    if (!secret) {
      throw new UnauthorizedException('AGENTS_TO_ENGINES_SECRET not configured')
    }

    const expected = crypto
      .createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(`${userId}:${workspaceId}:${ts}`)
      .digest('base64')

    if (!safeEqualB64(expected, auth.slice('Bearer '.length))) {
      throw new UnauthorizedException('invalid HMAC')
    }

    return true
  }
}
