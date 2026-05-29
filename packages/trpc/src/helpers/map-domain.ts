import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server'
import { isDomainError } from '@repo/domain'

const HTTP_TO_TRPC: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
}

export async function mapDomain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (isDomainError(e)) throw new TRPCError({ code: HTTP_TO_TRPC[e.httpStatus] ?? 'BAD_REQUEST', message: e.message })
    throw e
  }
}
