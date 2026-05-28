import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { McpModule as McpNestModule } from '@rekog/mcp-nest'
import { storage } from '@repo/storage'

import { McpAuthGuard } from '../api/auth/mcp-auth.guard.js'
import { McpExceptionFilter } from './errors/mcp-exception.filter.js'
import { createAgentsSearchClient } from './services/agents-search.client.js'
import { EmbeddingConfigService } from './services/embedding-config.service.js'
import { FileUploader, STORAGE } from './services/file-uploader.service.js'
import { PageFtsService } from './services/page-fts.service.js'
import { MarkdownParser } from './services/markdown-parser.service.js'
import { MarkdownRenderer } from './services/markdown-renderer.service.js'
import { PageWriter } from './services/page-writer.service.js'
import { StatsService } from './services/stats.service.js'
import { PageFileTools } from './tools/page-file.tools.js'
import { PageTools } from './tools/page.tools.js'
import { AGENTS_SEARCH_CLIENT, SearchTools } from './tools/search.tools.js'
import { ReminderService } from './services/reminder.service.js'
import { ReminderTools } from './tools/reminder.tools.js'
import { WorkspaceTools } from './tools/workspace.tools.js'
import { WorkspacesTools } from './tools/workspaces.tools.js'

@Module({
  imports: [
    McpNestModule.forRoot({
      name: 'anynote-engines',
      version: '0.1.0',
      guards: [McpAuthGuard],
    }),
  ],
  providers: [
    MarkdownParser,
    MarkdownRenderer,
    PageWriter,
    FileUploader,
    StatsService,
    PageFtsService,
    EmbeddingConfigService,
    PageTools,
    PageFileTools,
    WorkspaceTools,
    SearchTools,
    WorkspacesTools,
    ReminderService,
    ReminderTools,
    { provide: STORAGE, useValue: storage },
    { provide: APP_FILTER, useClass: McpExceptionFilter },
    {
      provide: AGENTS_SEARCH_CLIENT,
      useFactory: () => createAgentsSearchClient(process.env.AGENTS_URL ?? 'http://localhost:8080'),
    },
  ],
  exports: [PageTools, PageFileTools, WorkspaceTools, SearchTools, WorkspacesTools, ReminderTools],
})
export class McpModule {}
