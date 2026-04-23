import { BadRequestException, Body, Controller, Post } from "@nestjs/common"
import { ApiOkResponse, ApiTags } from "@nestjs/swagger"

import { searchPagesRequestSchema, type SearchPagesResponse } from "./dto/search.schema.js"
import { PageSearchService } from "./services/page-search.service.js"

// INTERNAL ENDPOINT: no auth. Do not expose on public ingress.
@ApiTags("search")
@Controller("search")
export class SearchController {
  constructor(private readonly service: PageSearchService) {}

  @Post("pages")
  @ApiOkResponse({ description: "RAG documents for the query" })
  async searchPages(@Body() body: unknown): Promise<SearchPagesResponse> {
    const parsed = searchPagesRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten())
    }

    const { workspaceId, query, topK, scoreThreshold } = parsed.data
    return this.service.search({ workspaceId, query, topK, scoreThreshold })
  }
}
