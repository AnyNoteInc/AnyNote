import "reflect-metadata"

import { NestFactory } from "@nestjs/core"

import { AppModule } from "./app.module.js"

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] })
  const port = Number(process.env.ENGINES_PORT ?? 8082)
  await app.listen(port)
}

bootstrap()
