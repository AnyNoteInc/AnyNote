import { Module } from '@nestjs/common'
import { Pool } from 'pg'

import { CleanupService } from './cleanup.service.js'

@Module({
  providers: [
    CleanupService,
    {
      provide: Pool,
      useFactory: () => new Pool({ connectionString: process.env.AGENTS_DATABASE_URL }),
    },
  ],
})
export class CleanupModule {}
