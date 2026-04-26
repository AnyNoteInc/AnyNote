import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common'
import type { Response } from 'express'

@Catch(HttpException)
export class McpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(McpExceptionFilter.name)

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const status = exception.getStatus()
    const body = exception.getResponse()
    this.log.warn(`MCP error ${status}: ${JSON.stringify(body)}`)
    res.status(status).json(typeof body === 'string' ? { message: body } : body)
  }
}
