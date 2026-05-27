import { Module } from '@nestjs/common'

import { AgentsInternalAuthGuard } from '../../auth/agents-internal-auth.guard.js'
import { McpModule } from '../mcp/mcp.module.js'

import { ApiKeyGuard } from './auth/api-key.guard.js'
import { McpAuthGuard } from './auth/mcp-auth.guard.js'
import { MetaController } from './rest/meta.controller.js'
import { PageFilesController } from './rest/page-files.controller.js'
import { PagesController } from './rest/pages.controller.js'
import { SearchController } from './rest/search.controller.js'
import { WorkspaceController } from './rest/workspace.controller.js'
import { WorkspacesController } from './rest/workspaces.controller.js'

@Module({
  imports: [McpModule],
  controllers: [
    PagesController,
    PageFilesController,
    SearchController,
    WorkspaceController,
    WorkspacesController,
    MetaController,
  ],
  providers: [ApiKeyGuard, McpAuthGuard, AgentsInternalAuthGuard],
})
export class ApiModule {}
