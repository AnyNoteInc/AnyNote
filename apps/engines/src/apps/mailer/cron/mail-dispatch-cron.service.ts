import { randomUUID } from 'node:crypto'

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { dispatchPending } from '@repo/mail/dispatch'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'

@Injectable()
export class MailDispatchCronService implements OnModuleInit {
  private readonly log = new Logger(MailDispatchCronService.name)
  private readonly workerId: string
  private readonly batch: number
  private readonly maxAttempts: number

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {
    this.workerId = `engines-mailer-${process.env.HOSTNAME ?? randomUUID().slice(0, 8)}`
    this.batch = Number(process.env.MAIL_DISPATCH_BATCH ?? 20)
    this.maxAttempts = Number(process.env.MAIL_DISPATCH_MAX_ATTEMPTS ?? 5)
  }

  onModuleInit(): void {
    this.log.log(`MailDispatchCron ready; worker=${this.workerId} batch=${this.batch}`)
  }

  @Cron(process.env.MAIL_DISPATCH_CRON_EXPRESSION ?? '*/30 * * * * *')
  async tick(): Promise<void> {
    try {
      const result = await dispatchPending(this.prisma, {
        batch: this.batch,
        maxAttempts: this.maxAttempts,
        workerId: this.workerId,
      })
      if (result.processed > 0) {
        this.log.log(
          `tick processed=${result.processed} ok=${result.succeeded} ` +
            `retry=${result.retried} fail=${result.failed}`,
        )
      }
    } catch (err) {
      this.log.error(`tick failed worker=${this.workerId}: ${(err as Error).message}`)
    }
  }
}
