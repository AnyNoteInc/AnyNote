import { Module } from "@nestjs/common"

import { BillingModule } from "./apps/billing/billing.module.js"
import { IndexerModule } from "./apps/indexer/indexer.module.js"
import { DbModule } from "./infra/db/db.module.js"

@Module({
  imports: [DbModule, BillingModule, IndexerModule],
})
export class CliModule {}
