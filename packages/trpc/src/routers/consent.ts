import { z } from 'zod'

import { ConsentDocumentType, ConsentSource } from '@repo/db'

import { router, protectedProcedure } from '../trpc'
import {
  ALL_CONSENT_TYPES,
  extractIpAddress,
  extractUserAgent,
  getCurrentConsents,
  writeConsentBatch,
  writeMarketingToggle,
} from '../lib/consents'

const SLUG_BY_TYPE: Record<ConsentDocumentType, string> = {
  USER_AGREEMENT: 'user-agreement',
  PRIVACY_POLICY: 'privacy-policy',
  PII_PROCESSING: 'consent',
  MARKETING: 'marketing-consent',
  PUBLIC_OFFER: 'public-offer',
}

const TITLE_BY_TYPE: Record<ConsentDocumentType, string> = {
  USER_AGREEMENT: 'Пользовательское соглашение',
  PRIVACY_POLICY: 'Политика обработки персональных данных',
  PII_PROCESSING: 'Согласие на обработку персональных данных',
  MARKETING: 'Согласие на получение информационных и рекламных рассылок',
  PUBLIC_OFFER: 'Оферта на оказание услуг',
}

const REQUIRED_BY_TYPE: Record<ConsentDocumentType, boolean> = {
  USER_AGREEMENT: true,
  PRIVACY_POLICY: true,
  PII_PROCESSING: true,
  MARKETING: false,
  PUBLIC_OFFER: true,
}

export const consentRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const current = await getCurrentConsents(ctx.prisma, ctx.user.id)
    return ALL_CONSENT_TYPES.map((type) => {
      const found = current.find((c) => c.documentType === type)
      return {
        documentType: type,
        title: TITLE_BY_TYPE[type],
        url: `/terms/${SLUG_BY_TYPE[type]}`,
        required: REQUIRED_BY_TYPE[type],
        granted: found?.granted ?? false,
        grantedAt: found?.grantedAt ?? null,
        documentVersion: found?.documentVersion ?? null,
      }
    })
  }),

  acceptRequired: protectedProcedure
    .input(z.object({ marketing: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await writeConsentBatch(ctx.prisma, {
        userId: ctx.user.id,
        marketing: input.marketing,
        source: ConsentSource.ONBOARDING,
        ipAddress: extractIpAddress(ctx.headers),
        userAgent: extractUserAgent(ctx.headers),
      })
      return { success: true }
    }),

  setMarketing: protectedProcedure
    .input(z.object({ granted: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await writeMarketingToggle(ctx.prisma, {
        userId: ctx.user.id,
        granted: input.granted,
        ipAddress: extractIpAddress(ctx.headers),
        userAgent: extractUserAgent(ctx.headers),
      })
      return { success: true }
    }),
})
