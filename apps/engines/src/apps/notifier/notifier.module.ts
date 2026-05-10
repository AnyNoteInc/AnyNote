import { Module } from '@nestjs/common'

import { NotifierCronService } from './cron/notifier-cron.service.js'

@Module({
  providers: [NotifierCronService],
})
export class NotifierModule {}
