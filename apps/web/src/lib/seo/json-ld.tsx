import 'server-only'

type JsonLdData = Record<string, unknown> | Record<string, unknown>[]

type JsonLdProps = { data: JsonLdData | null }

const SCRIPT_TAG_ESCAPE = String.raw`\u003c`

export function JsonLd({ data }: Readonly<JsonLdProps>) {
  if (data === null) return null
  const json = JSON.stringify(data).replaceAll('<', SCRIPT_TAG_ESCAPE)
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
