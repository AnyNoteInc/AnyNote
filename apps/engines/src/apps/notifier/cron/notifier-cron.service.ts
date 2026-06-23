import { hostname } from 'node:os'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import * as Sentry from '@sentry/nestjs'
import type { PrismaClient } from '@repo/db'
import { runDispatcherTick } from '@repo/notifications/worker'

import { PRISMA } from '../../../infra/db/db.providers.js'

@Injectable()
export class NotifierCronService {
  private readonly logger = new Logger(NotifierCronService.name)
  private readonly workerId = `notifier-${hostname()}-${process.pid}`
  private readonly batchSize = Number(process.env.NOTIFIER_BATCH_SIZE ?? 50)
  private readonly maxAttempts = Number(process.env.NOTIFIER_MAX_ATTEMPTS ?? 5)

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Cron(process.env.NOTIFIER_CRON_EXPRESSION ?? '*/5 * * * * *')
  async tick(): Promise<void> {
    try {
      await runDispatcherTick(this.prisma, {
        workerId: this.workerId,
        batchSize: this.batchSize,
        maxAttempts: this.maxAttempts,
      })
    } catch (err) {
      this.logger.error('dispatcher tick failed', err)
      Sentry.captureException(err, { tags: { service: 'engines', worker: 'notifier' } })
    }
  }
}
