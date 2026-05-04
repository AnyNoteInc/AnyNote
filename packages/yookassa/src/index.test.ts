import { describe, expect, it } from 'vitest'

import { YookassaClient, parseWebhookEvent, verifyTrustedIp } from './index.ts'

describe('@repo/yookassa scaffold', () => {
  it('exports planned public API placeholders', () => {
    expect(YookassaClient).toBeTypeOf('function')
    expect(parseWebhookEvent).toBeTypeOf('function')
    expect(verifyTrustedIp).toBeTypeOf('function')
  })
})
