import "reflect-metadata"
import "dotenv/config"

import { Logger } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"

import { AppModule } from "./app.module.js"

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] })
  app.setGlobalPrefix('api')
  app.enableShutdownHooks()

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Engines API")
    .setDescription("Engines service — indexer, MCP server, health endpoints")
    .setVersion("0.1.0")
    .addTag("health")
    .addTag("mcp")
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('docs', app, document)

  const port = Number(process.env.ENGINES_PORT ?? 8082)
  await app.listen(port)

  const logger = new Logger("bootstrap")
  logger.log(`engines listening on :${port}`)
  logger.log(`Swagger UI available at http://localhost:${port}/api/docs`)
}

bootstrap().catch((err) => {
  console.error("engines failed to boot", err)
  process.exit(1)
})
