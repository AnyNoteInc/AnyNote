import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { PageTools } from '../../mcp/tools/page.tools.js'
import type { AuthedRequest } from '../auth/auth-context.js'
import { McpAuthGuard } from '../auth/mcp-auth.guard.js'
import {
  CreatePageDto,
  GetPageMarkdownDto,
  GetPageStatsDto,
  MovePageDto,
  UpdatePageDto,
} from '../dto/pages.dto.js'

@Controller('v1/pages')
@ApiTags('pages')
@ApiBearerAuth()
@UseGuards(McpAuthGuard)
export class PagesController {
  constructor(private readonly pages: PageTools) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a new page in a workspace' })
  create(@Body() body: CreatePageDto, @Req() req: AuthedRequest) {
    return this.pages.doCreatePage(req.auth!, body as never)
  }

  @Post('update')
  @ApiOperation({ summary: 'Update page properties or content' })
  update(@Body() body: UpdatePageDto, @Req() req: AuthedRequest) {
    return this.pages.doUpdatePage(req.auth!, body as never)
  }

  @Post('move')
  @ApiOperation({ summary: 'Move a page to a new parent or position' })
  move(@Body() body: MovePageDto, @Req() req: AuthedRequest) {
    return this.pages.doMovePage(req.auth!, body as never)
  }

  @Post('markdown')
  @ApiOperation({ summary: 'Render a page as markdown' })
  markdown(@Body() body: GetPageMarkdownDto, @Req() req: AuthedRequest) {
    return this.pages.doGetPageMarkdown(req.auth!, body as never)
  }

  @Post('stats')
  @ApiOperation({ summary: 'Word count + summary statistics for a page' })
  stats(@Body() body: GetPageStatsDto, @Req() req: AuthedRequest) {
    return this.pages.doGetPageStats(req.auth!, body as never)
  }
}
