import { Module } from "@nestjs/common"

import { QdrantModule } from "../../infra/qdrant/qdrant.module.js"
import { IndexerModule } from "../indexer/indexer.module.js"
import { SearchController } from "./search.controller.js"
import { PageSearchService } from "./services/page-search.service.js"

@Module({
  imports: [IndexerModule, QdrantModule],
  controllers: [SearchController],
  providers: [PageSearchService],
})
export class SearchModule {}
