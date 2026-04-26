import { Command, CommandRunner } from 'nest-commander'

import { BackfillReindexService } from '../services/backfill-reindex.service.js'

@Command({
  name: 'backfill-reindex',
  description: 'Re-emit OutboxEvent for all TEXT pages',
})
export class BackfillReindexCommand extends CommandRunner {
  constructor(private readonly backfill: BackfillReindexService) {
    super()
  }

  async run(): Promise<void> {
    const result = await this.backfill.enqueueTextPages()
    console.log(`Enqueued ${result.inserted}/${result.total} pages for reindex`)
  }
}
