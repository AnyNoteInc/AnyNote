import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { formClientIp } from './form-rate-limit'

export type FormCaptchaAction = 'form_submit' | 'form_upload'

type VerifyFormCaptchaInput = {
  token: string | null | undefined
  action: FormCaptchaAction
  headers: Headers
  fetchImpl?: typeof fetch
  secret?: string
  nodeEnv?: string
  betterAuthUrl?: string
}

const recaptchaResponseSchema = z.object({
  success: z.boolean(),
  score: z.number().finite().min(0).max(1).optional(),
  action: z.string().optional(),
  hostname: z.string().optional(),
})

function captchaFailed(): TRPCError {
  return new TRPCError({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
}

export async function verifyFormCaptcha({
  token,
  action,
  headers,
  fetchImpl = globalThis.fetch,
  secret = process.env.RECAPTCHA_SECRET_KEY ?? '',
  nodeEnv = process.env.NODE_ENV,
  betterAuthUrl = process.env.BETTER_AUTH_URL,
}: VerifyFormCaptchaInput): Promise<void> {
  const production = nodeEnv === 'production'
  if (!secret.trim()) {
    if (production) throw captchaFailed()
    return
  }
  if (!token?.trim()) throw captchaFailed()

  try {
    const response = await fetchImpl('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: formClientIp(headers),
      }),
    })
    if (!response.ok) throw captchaFailed()

    const result = recaptchaResponseSchema.parse(await response.json())
    if (!result.success || result.action !== action || (result.score ?? 0) < 0.5) {
      throw captchaFailed()
    }
    if (production) {
      if (!betterAuthUrl || result.hostname !== new URL(betterAuthUrl).hostname) {
        throw captchaFailed()
      }
    }
  } catch {
    throw captchaFailed()
  }
}
