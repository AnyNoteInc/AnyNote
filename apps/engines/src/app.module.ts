import { Module } from "@nestjs/common"

import { HealthModule } from "./health/health.module.js"
import { DbModule } from "./infra/db/db.module.js"

@Module({
  imports: [DbModule, HealthModule],
})
export class AppModule {}
