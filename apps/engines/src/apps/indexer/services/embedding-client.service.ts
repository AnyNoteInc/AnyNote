import { Injectable } from "@nestjs/common"

import { OllamaService } from "../../../infra/ollama/ollama.service.js"

@Injectable()
export class EmbeddingClient {
  constructor(private readonly ollama: OllamaService) {}

  embed(text: string): Promise<number[]> {
    return this.ollama.embed(text)
  }
}
