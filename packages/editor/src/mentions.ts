export type MentionMember = {
  id: string
  name: string
  email: string | null
}

export type MentionItem = {
  id: string
  label: string
  email: string | null
}

export function filterMentionItems(
  members: readonly MentionMember[],
  query: string,
): MentionItem[] {
  const q = query.trim().toLowerCase()
  return members
    .filter((member) => {
      if (!q) return true
      return member.name.toLowerCase().includes(q) || (member.email ?? '').toLowerCase().includes(q)
    })
    .slice(0, 8)
    .map((member) => ({ id: member.id, label: member.name, email: member.email }))
}
