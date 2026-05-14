import 'server-only'

type JsonLdData = Record<string, unknown> | Record<string, unknown>[]

type JsonLdProps = { data: JsonLdData | null }

export function JsonLd({ data }: Readonly<JsonLdProps>) {
  if (data === null) return null
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
