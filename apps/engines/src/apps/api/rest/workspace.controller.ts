import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { WorkspaceTools } from '../../mcp/tools/workspace.tools.js'
import type { AuthedRequest } from '../auth/auth-context.js'
import { McpAuthGuard } from '../auth/mcp-auth.guard.js'
import {
  CreatePageFromFileDto,
  GetWorkspaceStatsDto,
  ListAgentsDto,
  ListSkillsDto,
  ListWorkspaceFilesDto,
} from '../dto/workspace.dto.js'

@Controller('v1/workspace')
@ApiTags('workspace')
@ApiBearerAuth()
@UseGuards(McpAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceTools: WorkspaceTools) {}

  @Post('stats')
  @ApiOperation({ summary: 'Get counts and membership summary for a workspace' })
  stats(@Body() body: GetWorkspaceStatsDto, @Req() req: AuthedRequest) {
    return this.workspaceTools.doGetWorkspaceStats(req.auth!, body as never)
  }

  @Post('files')
  @ApiOperation({ summary: 'List files uploaded to a workspace with pagination' })
  files(@Body() body: ListWorkspaceFilesDto, @Req() req: AuthedRequest) {
    return this.workspaceTools.doListWorkspaceFiles(req.auth!, body as never)
  }

  @Post('skills')
  @ApiOperation({ summary: 'List skill pages (ownership=SKILL) in a workspace' })
  skills(@Body() body: ListSkillsDto, @Req() req: AuthedRequest) {
    return this.workspaceTools.doListSkills(req.auth!, body as never)
  }

  @Post('agents')
  @ApiOperation({ summary: 'List agent pages (ownership=AGENT) in a workspace' })
  agents(@Body() body: ListAgentsDto, @Req() req: AuthedRequest) {
    return this.workspaceTools.doListAgents(req.auth!, body as never)
  }

  @Post('create-page-from-file')
  @ApiOperation({ summary: 'Create a page and attach an existing workspace file to it' })
  createPageFromFile(@Body() body: CreatePageFromFileDto, @Req() req: AuthedRequest) {
    return this.workspaceTools.doCreatePageFromFile(req.auth!, body as never)
  }
}
