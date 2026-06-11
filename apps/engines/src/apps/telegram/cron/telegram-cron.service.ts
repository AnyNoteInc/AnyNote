import { hostname } from 'node:os'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { PrismaClient } from '@repo/db'
import { runTelegramDeliveryTick, runTelegramFanOutTick } from '@repo/telegram/worker'

import { PRISMA } from '../../../infra/db/db.providers.js'

@Injectable()
export class TelegramCronService {
  private readonly logger = new Logger(TelegramCronService.name)
  private readonly workerId = `telegram-${hostname()}-${process.pid}`
  private readonly batchSize = Number(process.env.TELEGRAM_BATCH_SIZE ?? 20)
  private readonly maxAttempts = Number(process.env.TELEGRAM_MAX_ATTEMPTS ?? 8)
  private readonly timeoutMs = Number(process.env.TELEGRAM_TIMEOUT_MS ?? 10_000)

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Cron(process.env.TELEGRAM_CRON_EXPRESSION ?? '*/5 * * * * *')
  async tick(): Promise<void> {
    try {
      await runTelegramFanOutTick(this.prisma, {
        workerId: this.workerId,
        batchSize: this.batchSize,
      })
      await runTelegramDeliveryTick(this.prisma, {
        workerId: this.workerId,
        batchSize: this.batchSize,
        maxAttempts: this.maxAttempts,
        timeoutMs: this.timeoutMs,
      })
    } catch (err) {
      this.logger.error('telegram tick failed', err)
    }
  }
}
