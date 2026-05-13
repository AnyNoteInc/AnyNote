import { ConsentDocumentType, ConsentSource, type PrismaClient } from '@repo/db'

import { getDocumentVersionForType } from './document-versions'

export type CurrentConsent = {
  documentType: ConsentDocumentType
  granted: boolean
  grantedAt: Date
  documentVersion: string
}

const REQUIRED_TYPES: readonly ConsentDocumentType[] = [
  ConsentDocumentType.USER_AGREEMENT,
  ConsentDocumentType.PRIVACY_POLICY,
  ConsentDocumentType.PII_PROCESSING,
  ConsentDocumentType.PUBLIC_OFFER,
]

const ALL_TYPES: readonly ConsentDocumentType[] = [...REQUIRED_TYPES, ConsentDocumentType.MARKETING]

export const extractIpAddress = (headers: Headers): string | null => {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xri = headers.get('x-real-ip')
  return xri?.trim() || null
}

export const extractUserAgent = (headers: Headers): string | null => {
  const ua = headers.get('user-agent')
  if (!ua) return null
  return ua.length > 1024 ? ua.slice(0, 1024) : ua
}

export const getCurrentConsents = async (
  prisma: PrismaClient,
  userId: string,
): Promise<CurrentConsent[]> => {
  const rows = await prisma.userConsent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })

  const seen = new Map<ConsentDocumentType, CurrentConsent>()
  for (const row of rows) {
    if (seen.has(row.documentType)) continue
    seen.set(row.documentType, {
      documentType: row.documentType,
      granted: row.granted,
      grantedAt: row.createdAt,
      documentVersion: row.documentVersion,
    })
  }
  return [...seen.values()]
}

export const hasAllRequiredConsents = (current: CurrentConsent[]): boolean => {
  const granted = new Set(current.filter((c) => c.granted).map((c) => c.documentType))
  return REQUIRED_TYPES.every((t) => granted.has(t))
}

type WriteBatchArgs = {
  userId: string
  marketing: boolean
  source: ConsentSource
  ipAddress: string | null
  userAgent: string | null
}

export const writeConsentBatch = async (
  prisma: PrismaClient,
  args: WriteBatchArgs,
): Promise<void> => {
  const current = await getCurrentConsents(prisma, args.userId)
  const desired = new Map<ConsentDocumentType, boolean>()
  for (const t of REQUIRED_TYPES) desired.set(t, true)
  desired.set(ConsentDocumentType.MARKETING, args.marketing)

  const alreadyMatches = ALL_TYPES.every((t) => {
    const c = current.find((x) => x.documentType === t)
    return c?.granted === desired.get(t)
  })
  if (alreadyMatches) return

  await prisma.userConsent.createMany({
    data: ALL_TYPES.map((type) => ({
      userId: args.userId,
      documentType: type,
      granted: desired.get(type) as boolean,
      documentVersion: getDocumentVersionForType(type),
      source: args.source,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    })),
  })
}

type WriteMarketingArgs = {
  userId: string
  granted: boolean
  ipAddress: string | null
  userAgent: string | null
}

export const writeMarketingToggle = async (
  prisma: PrismaClient,
  args: WriteMarketingArgs,
): Promise<void> => {
  const last = await prisma.userConsent.findFirst({
    where: { userId: args.userId, documentType: ConsentDocumentType.MARKETING },
    orderBy: { createdAt: 'desc' },
  })

  if (last && last.granted === args.granted) return

  await prisma.userConsent.create({
    data: {
      userId: args.userId,
      documentType: ConsentDocumentType.MARKETING,
      granted: args.granted,
      documentVersion: getDocumentVersionForType(ConsentDocumentType.MARKETING),
      source: ConsentSource.SETTINGS,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    },
  })
}

export { REQUIRED_TYPES as REQUIRED_CONSENT_TYPES, ALL_TYPES as ALL_CONSENT_TYPES }
