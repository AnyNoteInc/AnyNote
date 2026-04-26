import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

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
    await this.renewal.expireCanceled()
    await this.renewal.renewActive()
  }
}
