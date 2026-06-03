import { describe, it, expect } from 'vitest'
import { participantName, participantInitials } from '@/components/kanban/components/participant-display'

describe('participantName', () => {
  it('uses the linked user full name', () => {
    expect(
      participantName({
        fullName: 'ignored',
        company: null,
        user: { id: 'u1', firstName: 'Анна', lastName: 'Петрова', email: 'a@x.io', image: null },
      }),
    ).toBe('Анна Петрова')
  })

  it('falls back to fullName for a guest', () => {
    expect(participantName({ fullName: 'Антон Гость', company: 'ООО', user: null })).toBe('Антон Гость')
  })

  it('falls back to email when a linked user has no name', () => {
    expect(
      participantName({
        fullName: 'x',
        company: null,
        user: { id: 'u3', firstName: null, lastName: null, email: 'noname@x.io', image: null },
      }),
    ).toBe('noname@x.io')
  })
})

describe('participantInitials', () => {
  it('returns two uppercase initials for a named guest', () => {
    expect(participantInitials({ fullName: 'Антон Кузнецов', company: null, user: null })).toBe('АК')
  })

  it('returns one initial for a single-word name', () => {
    expect(participantInitials({ fullName: 'Антон', company: null, user: null })).toBe('А')
  })
})
