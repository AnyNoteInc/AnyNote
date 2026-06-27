import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import * as Sentry from '@sentry/nestjs'

import { SubscriptionRenewalService } from '../services/subscription-renewal.service.js'

@Injectable()
export class SubscriptionRenewalCronService {
  private readonly logger = new Logger(SubscriptionRenewalCronService.name)

  constructor(private readonly renewal: SubscriptionRenewalService) {}

  @Cron(process.env.BILLING_RENEWAL_CRON_EXPRESSION ?? '0 0 0 * * *', {
    timeZone: 'Europe/Moscow',
  })
  async handleRenewals(): Promise<void> {
    this.logger.log('Starting subscription renewal cron')
    try {
      await this.renewal.expireCanceled()
      await this.renewal.renewActive()
    } catch (err) {
      // SentryGlobalFilter (APP_FILTER) only catches the HTTP request pipeline,
      // not @Cron throws — capture here or money-path failures vanish from ops.
      this.logger.error('subscription renewal cron failed', err)
      Sentry.captureException(err, {
        tags: { service: 'engines', worker: 'billing-renewal', integration: 'billing' },
      })
    }
  }
}
