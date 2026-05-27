import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

@Controller()
@ApiTags('meta')
export class MetaController {
  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe (no auth)' })
  health() {
    return { status: 'ok' }
  }

  @Get('v1/meta')
  @ApiOperation({ summary: 'Server metadata (no auth)' })
  @ApiOkResponse({
    schema: {
      properties: {
        version: { type: 'string' },
        mcpEndpoint: { type: 'string' },
        docs: { type: 'string' },
      },
    },
  })
  meta() {
    return { version: '0.1.0', mcpEndpoint: '/mcp', docs: '/docs' }
  }
}
