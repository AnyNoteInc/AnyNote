// Mock of apps/agents /validation/* for Playwright E2E. Returns ok by default.
// Sentinel: an LLM/embedding connection with apiKey === 'FAIL' (or MCP url containing 'fail')
// forces { ok:false } so the block-on-failed-ping path stays testable. Ignores the JWT.
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_AGENTS_PORT ?? 8091)

function readJson(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const server = createServer(async (req, res) => {
  const send = (body) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'POST') {
    res.writeHead(404)
    res.end()
    return
  }
  const body = await readJson(req)
  const apiKey = body?.connection?.apiKey
  const forceFail = apiKey === 'FAIL' || (typeof body?.url === 'string' && body.url.includes('fail'))
  if (req.url === '/validation/llm') {
    send(forceFail ? { ok: false, error: 'mock: forced failure' } : { ok: true, error: null })
  } else if (req.url === '/validation/embedding') {
    send(forceFail ? { ok: false, vectorSize: null, error: 'mock: forced failure' } : { ok: true, vectorSize: 1536, error: null })
  } else if (req.url === '/validation/mcp') {
    send(forceFail ? { ok: false, tools: [], error: 'mock: forced failure' } : { ok: true, tools: ['mock_search'], error: null })
  } else {
    res.writeHead(404)
    res.end()
  }
})

server.listen(PORT, () => console.log(`[mock-agents] listening on ${PORT}`))
