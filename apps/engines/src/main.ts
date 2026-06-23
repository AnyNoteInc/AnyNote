import './instrument.js'
import 'reflect-metadata'
import 'dotenv/config'

import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

import { AppModule } from './app.module.js'

const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] })
app.enableShutdownHooks()
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
app.enableCors({ origin: true, credentials: false })

const swaggerConfig = new DocumentBuilder()
  .setTitle('anynote API')
  .setDescription(
    'Public anynote API. Auth: `Authorization: Bearer ank_<your_key>`. ' +
      'Mint keys at https://anynote.ru/settings/api. ' +
      'Also available as MCP at `/mcp` (JSON-RPC, MCP 2025-11 spec, Bearer auth).',
  )
  .setVersion('0.1.0')
  .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'ank_<24>' }, 'ApiKey')
  .addTag('pages')
  .addTag('page-files')
  .addTag('workspace')
  .addTag('workspaces')
  .addTag('search')
  .addTag('meta')
  .build()
const document = SwaggerModule.createDocument(app, swaggerConfig)
SwaggerModule.setup('docs', app, document, {
  swaggerOptions: { persistAuthorization: true },
})

const port = Number(process.env.ENGINES_PORT ?? 8082)
await app.listen(port)

const logger = new Logger('bootstrap')
logger.log(`engines listening on :${port}`)
logger.log(`Swagger UI at http://localhost:${port}/docs`)
