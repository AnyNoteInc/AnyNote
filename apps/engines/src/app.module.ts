import { Module } from "@nestjs/common"

import { HealthModule } from "./health/health.module.js"
import { DbModule } from "./infra/db/db.module.js"
import { OllamaModule } from "./infra/ollama/ollama.module.js"
import { QdrantModule } from "./infra/qdrant/qdrant.module.js"

@Module({
  imports: [DbModule, QdrantModule, OllamaModule, HealthModule],
})
export class AppModule {}
