import 'server-only'

type JsonLdObject = Record<string, unknown>
type JsonLdData = JsonLdObject | JsonLdObject[]

type JsonLdProps = { data: JsonLdData | null }

const SCRIPT_TAG_ESCAPE = String.raw`<`

function stripContext(item: JsonLdObject): JsonLdObject {
  const result: JsonLdObject = {}
  for (const [key, value] of Object.entries(item)) {
    if (key !== '@context') result[key] = value
  }
  return result
}

function toDocument(data: JsonLdData): JsonLdObject {
  if (!Array.isArray(data)) return data
  return { '@context': 'https://schema.org', '@graph': data.map(stripContext) }
}

export function JsonLd({ data }: Readonly<JsonLdProps>) {
  if (data === null) return null
  const json = JSON.stringify(toDocument(data)).replaceAll('<', SCRIPT_TAG_ESCAPE)
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
