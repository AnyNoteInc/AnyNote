import type { BoardParticipant } from '../types'

type ParticipantLike = Pick<BoardParticipant, 'fullName' | 'company' | 'user'>

export function participantName(p: ParticipantLike): string {
  if (p.user) {
    const full = `${p.user.firstName ?? ''} ${p.user.lastName ?? ''}`.trim()
    return full || p.user.email
  }
  return p.fullName
}

export function participantImage(p: ParticipantLike): string | null {
  return p.user?.image ?? null
}

export function participantInitials(p: ParticipantLike): string {
  const name = participantName(p)
  const parts = name.split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const second = parts[1]?.[0] ?? ''
  return `${first}${second}`.toUpperCase()
}
