import { Injectable, Logger } from "@nestjs/common"
import axios, { AxiosInstance } from "axios"

export type ProcessingLanguage = "ru" | "en" | "auto"

type NormalizeResponse = {
  chunks: string[]
  language: "ru" | "en"
}

@Injectable()
export class ProcessingClient {
  private readonly log = new Logger(ProcessingClient.name)
  private readonly http: AxiosInstance

  constructor() {
    this.http = axios.create({
      baseURL: process.env.PROCESSING_SERVICE_URL ?? "http://localhost:8080",
      timeout: 10000,
    })
  }

  async normalize(text: string, language: ProcessingLanguage): Promise<string[]> {
    const maxAttempts = 3
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.http.post<NormalizeResponse>("/processing/normalize", {
          text,
          language,
        })
        return res.data.chunks
      } catch (err) {
        lastError = err
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)))
        }
      }
    }
    throw lastError
  }
}
