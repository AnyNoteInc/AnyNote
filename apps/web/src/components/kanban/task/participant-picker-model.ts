import type { BoardMember, BoardParticipant } from '../types'
import { participantName } from '../components/participant-display'

export interface PickerCandidate {
  readonly key: string // participantId if it exists, else `member:<userId>`
  readonly kind: 'participant' | 'member'
  readonly label: string
  readonly sublabel: string | null
  readonly inWorkspace: boolean
  readonly participantId: string | null
  readonly userId: string | null
  readonly image: string | null
  readonly initialsSource: BoardParticipant | { fullName: string; company: null; user: BoardMember['user'] }
}

export function buildCandidates(
  members: BoardMember[],
  participants: BoardParticipant[],
  query: string,
): PickerCandidate[] {
  const memberCandidates: PickerCandidate[] = members.map((m) => {
    const existing = participants.find((p) => p.userId === m.user.id)
    const name = `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email
    return {
      key: existing ? existing.id : `member:${m.user.id}`,
      kind: 'member',
      label: name,
      sublabel: m.user.email,
      inWorkspace: true,
      participantId: existing?.id ?? null,
      userId: m.user.id,
      image: m.user.image,
      initialsSource: { fullName: name, company: null, user: m.user },
    }
  })
  // Pure guests only — members that already have a mirror participant row are
  // shown via memberCandidates above (with their participantId attached).
  const guestCandidates: PickerCandidate[] = participants
    .filter((p) => !p.userId)
    .map((p) => ({
      key: p.id,
      kind: 'participant',
      label: participantName(p),
      sublabel: p.company,
      inWorkspace: false,
      participantId: p.id,
      userId: null,
      image: null,
      initialsSource: p,
    }))

  const q = query.trim().toLocaleLowerCase('ru-RU')
  const all = [...memberCandidates, ...guestCandidates]
  if (!q) return all
  return all.filter(
    (c) =>
      c.label.toLocaleLowerCase('ru-RU').includes(q) ||
      (c.sublabel?.toLocaleLowerCase('ru-RU').includes(q) ?? false),
  )
}
