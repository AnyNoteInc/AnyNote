import "reflect-metadata"

import { NestFactory } from "@nestjs/core"

import { AppModule } from "./app.module.js"

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] })
  app.enableShutdownHooks()
  const port = Number(process.env.ENGINES_PORT ?? 8082)
  await app.listen(port)
}

bootstrap().catch((err) => {
  console.error("engines failed to boot", err)
  process.exit(1)
})
