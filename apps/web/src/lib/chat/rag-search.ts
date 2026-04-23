export type RagDocument = {
  id: string
  title: string
  content: string
}

type SearchResponse = {
  documents?: Array<{
    id?: string
    title?: string
    content?: string
  }>
}

const SEARCH_TIMEOUT_MS = 5000

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
    const response = await fetch(`${process.env.ENGINES_SERVICE_URL ?? "http://localhost:8082"}/search/pages`, {
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
      id: document.id ?? "",
      title: document.title ?? "",
      content: document.content ?? "",
    }))
  } catch (error) {
    console.warn("RAG search failed", error)
    return []
  } finally {
    clearTimeout(timeout)
    args.signal?.removeEventListener("abort", onAbort)
  }
}
