import { Module } from '@nestjs/common'

import { TelegramCronService } from './cron/telegram-cron.service.js'

@Module({
  providers: [TelegramCronService],
})
export class TelegramModule {}
