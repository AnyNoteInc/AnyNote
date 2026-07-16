import { FormUnavailable } from '@/components/forms/form-unavailable'
import { getServerTRPC } from '@/trpc/server'

import { FormPageClient } from './form-page-client'

export default async function FormPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  try {
    const api = await getServerTRPC()
    const result = await api.form.getPublished({ locator: key })
    return result.status === 'OPEN' ? (
      <FormPageClient key={result.versionFingerprint} locator={key} published={result} />
    ) : (
      <FormUnavailable locator={key} state={result} />
    )
  } catch {
    return <FormUnavailable locator={key} state={{ status: 'UNAVAILABLE' }} />
  }
}
