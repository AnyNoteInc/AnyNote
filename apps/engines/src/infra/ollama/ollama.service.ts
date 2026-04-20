import { Injectable, Logger } from "@nestjs/common"
import axios, { AxiosInstance } from "axios"

@Injectable()
export class OllamaService {
  private readonly log = new Logger(OllamaService.name)
  private readonly http: AxiosInstance
  private readonly model: string

  constructor() {
    this.http = axios.create({
      baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      timeout: 30000,
    })
    this.model = process.env.EMBEDDING_MODEL ?? "nomic-embed-text"
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.http.post<{ embedding?: number[] }>("/api/embeddings", {
      model: this.model,
      prompt: text,
    })
    const embedding = res.data.embedding
    if (!embedding || embedding.length === 0) {
      throw new Error("Ollama returned empty embedding")
    }
    return embedding
  }
}
