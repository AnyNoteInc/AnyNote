const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false
  const d = new Date(s)
  return !Number.isNaN(d.getTime())
}

export function computeAge(
  birthDate: string | undefined,
  deathDate?: string,
  now: Date = new Date(),
): number | undefined {
  if (!birthDate || !isValidIsoDate(birthDate)) return undefined
  const birth = new Date(birthDate)
  const end = deathDate && isValidIsoDate(deathDate) ? new Date(deathDate) : now
  let age = end.getFullYear() - birth.getFullYear()
  const m = end.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--
  return age < 0 ? undefined : age
}
