import { Module } from "@nestjs/common"

import { HealthModule } from "./health/health.module.js"
import { DbModule } from "./infra/db/db.module.js"
import { QdrantModule } from "./infra/qdrant/qdrant.module.js"

@Module({
  imports: [DbModule, QdrantModule, HealthModule],
})
export class AppModule {}
