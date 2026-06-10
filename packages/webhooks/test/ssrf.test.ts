import { describe, expect, it } from 'vitest'

import { SsrfBlockedError, assertSafeWebhookUrl, isBlockedAddress } from '../src/ssrf.ts'

import type { LookupFn } from '../src/ssrf.ts'

const lookupReturning =
  (...addresses: Array<{ address: string; family: number }>): LookupFn =>
  () =>
    Promise.resolve(addresses)

describe('isBlockedAddress — IPv4', () => {
  it.each([
    ['0.0.0.0', '0.0.0.0/8'],
    ['0.255.255.255', '0.0.0.0/8'],
    ['10.0.0.1', '10.0.0.0/8'],
    ['10.255.255.255', '10.0.0.0/8'],
    ['127.0.0.1', '127.0.0.0/8'],
    ['100.64.0.1', '100.64.0.0/10 (CGN)'],
    ['100.127.255.255', '100.64.0.0/10 (CGN)'],
    ['169.254.0.1', '169.254.0.0/16 (link-local)'],
    ['169.254.169.254', 'cloud metadata'],
    ['172.16.0.1', '172.16.0.0/12'],
    ['172.31.255.255', '172.16.0.0/12'],
    ['192.168.1.1', '192.168.0.0/16'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address, 4)).toBe(true)
  })

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['100.63.255.255'],
    ['100.128.0.0'],
    ['172.15.255.255'],
    ['172.32.0.0'],
    ['192.167.255.255'],
    ['11.0.0.1'],
  ])('allows public address %s', (address) => {
    expect(isBlockedAddress(address, 4)).toBe(false)
  })
})

describe('isBlockedAddress — IPv6', () => {
  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fc00::1', 'fc00::/7 ULA'],
    ['fd12:3456:789a::1', 'fc00::/7 ULA'],
    ['fe80::1', 'fe80::/10 link-local'],
    ['febf::1', 'fe80::/10 link-local'],
    ['::ffff:127.0.0.1', 'mapped loopback'],
    ['::ffff:10.0.0.1', 'mapped private'],
    ['::ffff:192.168.0.1', 'mapped private'],
    ['::ffff:169.254.169.254', 'mapped metadata'],
    ['::ffff:c0a8:1', 'mapped private (hex form)'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address, 6)).toBe(true)
  })

  it.each([['2001:4860:4860::8888'], ['2606:4700::1111'], ['::ffff:8.8.8.8']])(
    'allows public address %s',
    (address) => {
      expect(isBlockedAddress(address, 6)).toBe(false)
    },
  )
})

describe('assertSafeWebhookUrl', () => {
  it('accepts an https URL resolving to a public address', async () => {
    await expect(
      assertSafeWebhookUrl(
        'https://hooks.example.com/x',
        lookupReturning({ address: '8.8.8.8', family: 4 }),
      ),
    ).resolves.toBeUndefined()
  })

  it('rejects non-https URLs', async () => {
    await expect(
      assertSafeWebhookUrl(
        'http://hooks.example.com/x',
        lookupReturning({ address: '8.8.8.8', family: 4 }),
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('rejects URLs with userinfo', async () => {
    await expect(
      assertSafeWebhookUrl(
        'https://user:pass@hooks.example.com/x',
        lookupReturning({ address: '8.8.8.8', family: 4 }),
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('rejects unparseable URLs', async () => {
    await expect(assertSafeWebhookUrl('not a url')).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('classifies IPv4 literals without a DNS lookup', async () => {
    const neverLookup: LookupFn = () => Promise.reject(new Error('must not be called'))
    await expect(assertSafeWebhookUrl('https://10.0.0.5/x', neverLookup)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    )
    await expect(assertSafeWebhookUrl('https://8.8.8.8/x', neverLookup)).resolves.toBeUndefined()
  })

  it('classifies IPv6 literals without a DNS lookup', async () => {
    const neverLookup: LookupFn = () => Promise.reject(new Error('must not be called'))
    await expect(assertSafeWebhookUrl('https://[::1]/x', neverLookup)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    )
  })

  it('blocks a public-looking hostname resolving to a private IP (DNS rebinding)', async () => {
    await expect(
      assertSafeWebhookUrl(
        'https://innocent.example.com/x',
        lookupReturning({ address: '192.168.0.10', family: 4 }),
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('blocks when ANY of multiple A records is private', async () => {
    await expect(
      assertSafeWebhookUrl(
        'https://multi.example.com/x',
        lookupReturning({ address: '8.8.8.8', family: 4 }, { address: '10.1.2.3', family: 4 }),
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('treats DNS failure as blocked', async () => {
    const failingLookup: LookupFn = () => Promise.reject(new Error('ENOTFOUND'))
    await expect(
      assertSafeWebhookUrl('https://gone.example.com/x', failingLookup),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('treats an empty DNS answer as blocked', async () => {
    await expect(
      assertSafeWebhookUrl('https://empty.example.com/x', lookupReturning()),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })
})
