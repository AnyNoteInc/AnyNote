import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({
    description: 'Service is healthy',
    schema: { example: { status: 'ok' } },
  })
  health() {
    return { status: 'ok' }
  }
}
