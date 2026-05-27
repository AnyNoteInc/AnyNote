import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { PageFileTools } from '../../mcp/tools/page-file.tools.js'
import type { AuthedRequest } from '../auth/auth-context.js'
import { McpAuthGuard } from '../auth/mcp-auth.guard.js'
import {
  AttachFileToPageDto,
  AttachImageToPageDto,
  ListPageFilesDto,
  UploadFileToPageDto,
  UploadImageToPageDto,
} from '../dto/page-files.dto.js'

@Controller('v1/page-files')
@ApiTags('page-files')
@ApiBearerAuth()
@UseGuards(McpAuthGuard)
export class PageFilesController {
  constructor(private readonly pageFileTools: PageFileTools) {}

  @Post('upload-file')
  @ApiOperation({ summary: 'Upload a small file (<=1 MB) to a page via base64' })
  uploadFile(@Body() body: UploadFileToPageDto, @Req() req: AuthedRequest) {
    return this.pageFileTools.doUploadFileToPage(req.auth!, body as never)
  }

  @Post('upload-image')
  @ApiOperation({ summary: 'Upload a small image (<=1 MB) to a page via base64' })
  uploadImage(@Body() body: UploadImageToPageDto, @Req() req: AuthedRequest) {
    return this.pageFileTools.doUploadImageToPage(req.auth!, body as never)
  }

  @Post('attach-file')
  @ApiOperation({ summary: 'Attach an existing workspace file to a page by id' })
  attachFile(@Body() body: AttachFileToPageDto, @Req() req: AuthedRequest) {
    return this.pageFileTools.doAttachFileToPage(req.auth!, body as never)
  }

  @Post('attach-image')
  @ApiOperation({ summary: 'Attach an existing workspace image to a page by id' })
  attachImage(@Body() body: AttachImageToPageDto, @Req() req: AuthedRequest) {
    return this.pageFileTools.doAttachImageToPage(req.auth!, body as never)
  }

  @Post('list')
  @ApiOperation({ summary: 'List files attached to a page' })
  list(@Body() body: ListPageFilesDto, @Req() req: AuthedRequest) {
    return this.pageFileTools.doListPageFiles(req.auth!, body as never)
  }
}
