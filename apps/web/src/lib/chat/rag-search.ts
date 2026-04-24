export type RagDocument = {
  pageId: string
  workspaceId: string
  chunkIndex: number
  title: string
  content: string
  pageType: string
  createdById: string
  createdAt: string
  updatedAt: string
}

type SearchResponse = {
  documents?: Array<{
    id?: string
    pageId?: string
    workspaceId?: string
    chunkIndex?: number
    title?: string
    content?: string
    pageType?: string
    createdById?: string
    createdAt?: string
    updatedAt?: string
  }>
}

const SEARCH_TIMEOUT_MS = 5000

function getEnginesSearchUrl(): string {
  const host = process.env.ENGINES_URL ?? "localhost"
  const port = process.env.ENGINES_PORT ?? "8090"
  return `http://${host}:${port}/search/pages`
}

export async function searchRagDocuments(args: {
  workspaceId: string
  query: string
  topK?: number
  signal?: AbortSignal
}): Promise<RagDocument[]> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(args.signal?.reason)
  const timeout = setTimeout(() => controller.abort(new DOMException("Timed out", "AbortError")), SEARCH_TIMEOUT_MS)

  if (args.signal) {
    if (args.signal.aborted) {
      controller.abort(args.signal.reason)
    } else {
      args.signal.addEventListener("abort", onAbort, { once: true })
    }
  }

  try {
    const response = await fetch(getEnginesSearchUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: args.workspaceId,
        query: args.query,
        topK: args.topK,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn(`RAG search failed with status ${response.status}`)
      return []
    }

    const payload = (await response.json()) as SearchResponse
    if (!Array.isArray(payload.documents)) {
      console.warn("RAG search returned an invalid payload")
      return []
    }

    return payload.documents.map((document) => ({
      pageId: document.pageId ?? document.id ?? "",
      workspaceId: document.workspaceId ?? args.workspaceId,
      chunkIndex: typeof document.chunkIndex === "number" ? document.chunkIndex : 0,
      title: document.title ?? "",
      content: document.content ?? "",
      pageType: document.pageType ?? "",
      createdById: document.createdById ?? "",
      createdAt: document.createdAt ?? "",
      updatedAt: document.updatedAt ?? "",
    }))
  } catch (error) {
    console.warn("RAG search failed", error)
    return []
  } finally {
    clearTimeout(timeout)
    args.signal?.removeEventListener("abort", onAbort)
  }
}
