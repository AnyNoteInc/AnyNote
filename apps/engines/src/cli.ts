import { CommandFactory } from "nest-commander"
import { config } from "dotenv"
import { fileURLToPath } from "node:url"

async function bootstrap(): Promise<void> {
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true })

  const { CliModule } = await import("./cli.module.js")
  await CommandFactory.run(CliModule, { logger: ["error", "warn", "log"] })
}

bootstrap().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
