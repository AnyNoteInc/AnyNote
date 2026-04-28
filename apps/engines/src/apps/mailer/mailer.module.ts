import { Module } from '@nestjs/common'

import { MailDispatchCronService } from './cron/mail-dispatch-cron.service.js'

@Module({
  providers: [MailDispatchCronService],
})
export class MailerModule {}
