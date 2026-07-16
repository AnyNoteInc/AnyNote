import { Module } from '@nestjs/common'
import { storage } from '@repo/storage'
import { Pool } from 'pg'

import { CLEANUP_STORAGE, CleanupService } from './cleanup.service.js'

@Module({
  providers: [
    CleanupService,
    { provide: CLEANUP_STORAGE, useValue: storage },
    {
      provide: Pool,
      useFactory: () => new Pool({ connectionString: process.env.AGENTS_DATABASE_URL }),
    },
  ],
})
export class CleanupModule {}
