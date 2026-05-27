import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { WorkspacesTools } from '../../mcp/tools/workspaces.tools.js'
import type { AuthedRequest } from '../auth/auth-context.js'
import { McpAuthGuard } from '../auth/mcp-auth.guard.js'
import { ListWorkspacesResultDto } from '../dto/workspaces.dto.js'

@Controller('v1/workspaces')
@ApiTags('workspaces')
@ApiBearerAuth()
@UseGuards(McpAuthGuard)
export class WorkspacesController {
  constructor(private readonly tool: WorkspacesTools) {}

  @Get()
  @ApiOperation({ summary: 'List workspaces the caller is a member of' })
  @ApiOkResponse({ type: ListWorkspacesResultDto })
  list(@Req() req: AuthedRequest) {
    return this.tool.doListWorkspaces(req.auth!)
  }
}
