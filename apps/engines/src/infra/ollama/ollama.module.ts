import { Global, Module } from "@nestjs/common"

import { OllamaService } from "./ollama.service.js"

@Global()
@Module({
  providers: [OllamaService],
  exports: [OllamaService],
})
export class OllamaModule {}
