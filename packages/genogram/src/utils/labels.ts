import type { Person } from '../types'

export function formatPersonLabelLines(person: Person): string[] {
  const lines: string[] = []

  const name = joinNonEmpty([person.identity.firstName, person.identity.lastName], ' ')
  if (name) {
    lines.push(name)
  } else if (person.identity.isUnknown) {
    lines.push('?')
  }

  const birth = person.lifeDates.birthDate
  const death = person.lifeDates.deathDate
  if (birth && death) {
    lines.push(`${birth.slice(0, 4)}—${death.slice(0, 4)}`)
  } else if (birth) {
    lines.push(`р. ${birth.slice(0, 4)}`)
  } else if (death) {
    lines.push(`ум. ${death.slice(0, 4)}`)
  }

  if (person.profile.profession) {
    lines.push(person.profile.profession)
  }

  return lines
}

function joinNonEmpty(parts: (string | undefined)[], sep: string): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(sep)
}
