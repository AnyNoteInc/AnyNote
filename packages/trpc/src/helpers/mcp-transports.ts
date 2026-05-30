// Single source of truth for the MCP transport identifiers on the TypeScript
// side. Kept in sync by hand with the Prisma `McpTransport` enum
// (packages/db/prisma/schema.prisma) and the Python `McpServerSchema.transport`
// Literal (apps/agents .../agent/schemas.py) — cross-language codegen isn't
// available, but every TS layer (tRPC router/validator, agent run payload, the
// settings UI) derives from this one const so a new transport is a one-line
// change here.
//
// Order mirrors the Prisma enum.

export const MCP_TRANSPORTS = ['HTTP_JSONRPC', 'SSE', 'STREAMABLE_HTTP'] as const

export type McpTransport = (typeof MCP_TRANSPORTS)[number]

// Display labels for the settings dropdown. Co-located so a new transport's
// option can't drift from its value.
export const MCP_TRANSPORT_LABELS: Record<McpTransport, string> = {
  HTTP_JSONRPC: 'HTTP JSON-RPC',
  SSE: 'SSE',
  STREAMABLE_HTTP: 'Streamable HTTP',
}
