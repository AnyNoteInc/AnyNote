import { hostname } from 'node:os'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { PrismaClient } from '@repo/db'
import { runDeliveryTick, runFanOutTick } from '@repo/webhooks/worker'

import { PRISMA } from '../../../infra/db/db.providers.js'

@Injectable()
export class WebhookCronService {
  private readonly logger = new Logger(WebhookCronService.name)
  private readonly workerId = `webhook-${hostname()}-${process.pid}`
  private readonly batchSize = Number(process.env.WEBHOOK_BATCH_SIZE ?? 20)
  private readonly maxAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 8)
  private readonly timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 10_000)

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Cron(process.env.WEBHOOK_CRON_EXPRESSION ?? '*/5 * * * * *')
  async tick(): Promise<void> {
    try {
      await runFanOutTick(this.prisma, { workerId: this.workerId, batchSize: this.batchSize })
      await runDeliveryTick(this.prisma, {
        workerId: this.workerId,
        batchSize: this.batchSize,
        maxAttempts: this.maxAttempts,
        timeoutMs: this.timeoutMs,
      })
    } catch (err) {
      this.logger.error('webhook tick failed', err)
    }
  }
}
