export async function qdrantHasPointForBlock(
  pageId: string,
  blockNumber: number,
  opts: { baseUrl?: string; apiKey?: string } = {},
): Promise<boolean> {
  const baseUrl = opts.baseUrl ?? process.env.QDRANT_URL ?? "http://localhost:6333"
  const apiKey = opts.apiKey ?? process.env.QDRANT_API_KEY ?? process.env.QDRANT__AUTH__BEARER_TOKEN
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (apiKey) headers["api-key"] = apiKey
  const res = await fetch(`${baseUrl}/collections/pages/points/scroll`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      filter: {
        must: [
          { key: "pageId", match: { value: pageId } },
          { key: "blockNumber", match: { value: blockNumber } },
        ],
      },
      limit: 1,
      with_payload: false,
      with_vector: false,
    }),
  })
  if (!res.ok) return false
  const body = (await res.json()) as { result?: { points?: unknown[] } }
  return (body.result?.points?.length ?? 0) > 0
}
