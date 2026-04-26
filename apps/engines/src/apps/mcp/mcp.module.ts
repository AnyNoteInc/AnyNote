import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { McpModule as McpNestModule } from '@rekog/mcp-nest'
import { storage } from '@repo/storage'

import { McpExceptionFilter } from './errors/mcp-exception.filter.js'
import { McpTokenGuard } from './guards/mcp-token.guard.js'
import { WorkspaceMemberGuard } from './guards/workspace-member.guard.js'
import { FileUploader, STORAGE } from './services/file-uploader.service.js'
import { MarkdownRenderer } from './services/markdown-renderer.service.js'
import { PageWriter } from './services/page-writer.service.js'
import { StatsService } from './services/stats.service.js'
import { PageFileTools } from './tools/page-file.tools.js'
import { PageTools } from './tools/page.tools.js'
import { WorkspaceTools } from './tools/workspace.tools.js'

@Module({
  imports: [
    McpNestModule.forRoot({
      name: 'anynote-engines',
      version: '0.1.0',
      guards: [McpTokenGuard],
    }),
  ],
  providers: [
    McpTokenGuard,
    WorkspaceMemberGuard,
    MarkdownRenderer,
    PageWriter,
    FileUploader,
    StatsService,
    PageTools,
    PageFileTools,
    WorkspaceTools,
    { provide: STORAGE, useValue: storage },
    { provide: APP_FILTER, useClass: McpExceptionFilter },
  ],
})
export class McpModule {}
