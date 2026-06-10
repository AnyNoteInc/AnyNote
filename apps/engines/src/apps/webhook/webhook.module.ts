import { Module } from '@nestjs/common'

import { WebhookCronService } from './cron/webhook-cron.service.js'

@Module({
  providers: [WebhookCronService],
})
export class WebhookModule {}
