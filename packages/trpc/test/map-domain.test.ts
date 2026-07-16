import { describe, expect, it } from 'vitest'

import { DomainError, forbidden, FormValidationError } from '@repo/domain'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import type { TRPCError } from '@trpc/server'

import { mapDomain } from '../src/helpers/map-domain'
import { publicProcedure, router } from '../src/trpc'

const fieldErrors = {
  'question-name': ['REQUIRED_ANSWER'],
  'question-person': ['FORM_TARGET_INACCESSIBLE'],
}

async function mappedError(error: Error): Promise<TRPCError> {
  try {
    await mapDomain(async () => {
      throw error
    })
  } catch (mapped) {
    return mapped as TRPCError
  }
  throw new Error('Expected mapDomain to throw')
}

function formatError(error: TRPCError) {
  const formatter = router({})._def._config.errorFormatter
  return formatter({
    error,
    type: 'mutation',
    path: 'form.submit',
    input: undefined,
    ctx: undefined,
    shape: {
      message: error.message,
      code: -32600,
      data: { code: error.code, httpStatus: 400 },
    },
  } as never)
}

describe('mapDomain', () => {
  it('translates DomainError to TRPCError by httpStatus', async () => {
    await expect(
      mapDomain(async () => {
        throw forbidden('nope')
      }),
    ).rejects.toMatchObject({ name: 'TRPCError', code: 'FORBIDDEN' })
  })

  it('passes non-domain errors through', async () => {
    const error = new Error('boom')
    await expect(
      mapDomain(async () => {
        throw error
      }),
    ).rejects.toBe(error)
  })

  it('returns the value on success', async () => {
    await expect(mapDomain(async () => 42)).resolves.toBe(42)
  })

  it('preserves safe question-keyed validation details for server callers', async () => {
    const error = await mappedError(new FormValidationError(fieldErrors))

    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'FORM_ANSWERS_INVALID',
      cause: { details: { fieldErrors } },
    })
  })

  it('adds safe field errors to the HTTP error shape', async () => {
    const error = await mappedError(new FormValidationError(fieldErrors))

    expect(formatError(error).data).toMatchObject({ fieldErrors })
  })

  it('serializes safe field errors for an HTTP client', async () => {
    const httpRouter = router({
      submit: publicProcedure.mutation(() =>
        mapDomain(async () => {
          throw new FormValidationError(fieldErrors)
        }),
      ),
    })
    const response = await fetchRequestHandler({
      endpoint: '/api/trpc',
      req: new Request('http://localhost/api/trpc/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'null',
      }),
      router: httpRouter,
      createContext: () => ({}) as never,
    })

    const payload = (await response.json()) as {
      error: { data: { fieldErrors?: unknown } }
    }
    expect(response.status).toBe(400)
    expect(payload.error.data.fieldErrors).toEqual(fieldErrors)
  })

  it('leaves unrelated domain errors unchanged', async () => {
    const error = await mappedError(forbidden('UNRELATED_FORBIDDEN'))
    const formatted = formatError(error)

    expect(formatted.message).toBe('UNRELATED_FORBIDDEN')
    expect(formatted.data).not.toHaveProperty('fieldErrors')
  })

  it('drops unsafe validation details instead of exposing raw values', async () => {
    const unsafeFields = { question: ['INTERNAL_SECRET_TOKEN_ABC123'] }
    const unsafe = Object.assign(
      new DomainError('BAD_REQUEST', 'FORM_ANSWERS_INVALID', 400, {
        fieldErrors: unsafeFields,
      }),
      { fieldErrors: unsafeFields },
    )
    const error = await mappedError(unsafe)

    expect(formatError(error).data).not.toHaveProperty('fieldErrors')
  })
})
