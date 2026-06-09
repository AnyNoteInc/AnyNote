import { Module } from '@nestjs/common'

import { PlanFeaturesService } from '../indexer/services/plan-features.service.js'
import { HistoryPruneService } from './history-prune.service.js'

@Module({
  providers: [HistoryPruneService, PlanFeaturesService],
})
export class HistoryModule {}
