import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { SearchTools } from '../../mcp/tools/search.tools.js'
import type { AuthedRequest } from '../auth/auth-context.js'
import { McpAuthGuard } from '../auth/mcp-auth.guard.js'
import { SearchPagesDto, SearchPagesResultDto } from '../dto/search.dto.js'

@Controller('v1/search')
@ApiTags('search')
@ApiBearerAuth()
@UseGuards(McpAuthGuard)
export class SearchController {
  constructor(private readonly searchTools: SearchTools) {}

  @Post('pages')
  @ApiOperation({ summary: 'Semantic search across workspace pages via embeddings' })
  @ApiOkResponse({ type: SearchPagesResultDto })
  pages(@Body() body: SearchPagesDto, @Req() req: AuthedRequest) {
    return this.searchTools.doSearchPages(req.auth!, body as never)
  }
}
