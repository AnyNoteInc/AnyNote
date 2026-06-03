import { describe, it, expect } from 'vitest'
import { buildCandidates } from '@/components/kanban/task/participant-picker-model'

const member = {
  userId: 'u1', role: 'EDITOR',
  user: { id: 'u1', firstName: 'Анна', lastName: 'Петрова', email: 'a@x.io', image: null },
}
const guest = { id: 'p9', userId: null, fullName: 'Антон Гость', company: 'ООО', user: null }

describe('buildCandidates', () => {
  it('lists members first, then pure guests', () => {
    const res = buildCandidates([member], [guest], '')
    expect(res[0]!.kind).toBe('member')
    expect(res[1]!.kind).toBe('participant')
  })

  it('uses an existing mirror participant id for a member', () => {
    const mirror = { id: 'pm', userId: 'u1', fullName: 'Анна Петрова', company: null, user: member.user }
    const res = buildCandidates([member], [mirror], '')
    expect(res[0]!.participantId).toBe('pm')
  })

  it('filters by query across name and sublabel', () => {
    const res = buildCandidates([member], [guest], 'ромашка')
    expect(res).toHaveLength(0)
    const res2 = buildCandidates([member], [guest], 'гост')
    expect(res2).toHaveLength(1)
    expect(res2[0]!.label).toBe('Антон Гость')
  })
})
