import { describe, expect, it } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'

import type { AuthContext } from './auth-context.js'
import { assertNotPageBound, assertPageBindingAllows } from './page-binding.js'

const unbound: AuthContext = { userId: 'u1', source: 'internal' }
const bound: AuthContext = { userId: 'u1', source: 'internal', boundPageId: 'p1' }

describe('assertPageBindingAllows', () => {
  it('allows any page when the auth context carries no binding', () => {
    expect(() => assertPageBindingAllows(unbound, 'p2')).not.toThrow()
  })

  it('allows the bound page itself', () => {
    expect(() => assertPageBindingAllows(bound, 'p1')).not.toThrow()
  })

  it('throws ForbiddenException on a mismatched page', () => {
    expect(() => assertPageBindingAllows(bound, 'p2')).toThrow(ForbiddenException)
    expect(() => assertPageBindingAllows(bound, 'p2')).toThrow(
      'Этот чат привязан к другой странице — изменять можно только страницу p1',
    )
  })
})

describe('assertNotPageBound', () => {
  it('allows when the auth context carries no binding', () => {
    expect(() => assertNotPageBound(unbound, 'создание новых страниц')).not.toThrow()
  })

  it('throws ForbiddenException when the chat is page-bound', () => {
    expect(() => assertNotPageBound(bound, 'создание новых страниц')).toThrow(ForbiddenException)
    expect(() => assertNotPageBound(bound, 'создание новых страниц')).toThrow(
      'Этот чат привязан к странице p1 — создание новых страниц здесь недоступно',
    )
  })
})
