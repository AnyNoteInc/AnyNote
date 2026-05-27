import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { VectorizationCronService } from './cron/vectorization-cron.service.js'
import { PlaywrightGuard } from './playwright.guard.js'

/**
 * Test-only HTTP controller for the indexer. All endpoints are gated by
 * PlaywrightGuard and are dead in any environment where PLAYWRIGHT !== 'true'.
 */
@ApiTags('indexer')
@Controller('internal/indexer')
export class IndexerController {
  constructor(private readonly cronService: VectorizationCronService) {}

  /**
   * Synchronously drain all pending outbox events for a workspace. Used by
   * Playwright E2E tests to avoid waiting for the 5-minute cron tick.
   */
  @Post('test/index-now')
  @UseGuards(PlaywrightGuard)
  async indexNow(@Body() body: { workspaceId: string }): Promise<{ ok: boolean }> {
    await this.cronService.drainOutboxForWorkspace(body.workspaceId)
    return { ok: true }
  }
}
