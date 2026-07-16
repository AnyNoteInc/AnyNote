import { notFound } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'

import { OwnResponseClient } from './own-response-client'

function isNotFoundError(error: unknown): boolean {
  if (error instanceof TRPCError) return error.code === 'NOT_FOUND'
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'NOT_FOUND'
  )
}

export default async function OwnResponsePage({
  params,
}: {
  params: Promise<{ key: string; submissionId: string }>
}) {
  const { key, submissionId } = await params
  const ownResponsePath = `/f/${encodeURIComponent(key)}/responses/${encodeURIComponent(submissionId)}`
  await requireSession(`/sign-in?redirect=${encodeURIComponent(ownResponsePath)}`)
  const api = await getServerTRPC()

  try {
    const response = await api.form.getOwnResponse({ locator: key, submissionId })
    return <OwnResponseClient locator={key} submissionId={submissionId} response={response} />
  } catch (error) {
    if (isNotFoundError(error)) notFound()
    throw error
  }
}
