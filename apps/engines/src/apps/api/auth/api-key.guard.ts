import { createHash } from 'node:crypto'

import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'

import type { AuthedRequest } from './auth-context.js'

const TOKEN_PREFIX = 'ank_'
const TOUCH_THROTTLE_MS = 60_000

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    const raw = req.headers.authorization
    const auth = Array.isArray(raw) ? raw[0] : raw
    if (!auth || !auth.startsWith('Bearer ')) return false

    const token = auth.slice(7)
    if (!token.startsWith(TOKEN_PREFIX)) return false

    const hash = createHash('sha256').update(token).digest('hex')
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hash } })
    if (!key) throw new UnauthorizedException('Invalid API key')
    if (key.revokedAt) throw new UnauthorizedException('API key revoked')
    if (key.expiresAt && key.expiresAt < new Date())
      throw new UnauthorizedException('API key expired')

    req.auth = { userId: key.userId, apiKeyId: key.id, source: 'api-key' }
    this.touchLastUsed(key.id, key.lastUsedAt)
    return true
  }

  private touchLastUsed(id: string, prev: Date | null): void {
    if (prev && Date.now() - prev.getTime() < TOUCH_THROTTLE_MS) return
    this.prisma.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined)
  }
}
