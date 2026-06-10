import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>

const defaultLookup: LookupFn = (h) => dnsLookup(h, { all: true, verbatim: true })

export class SsrfBlockedError extends Error {}

function parseIpv4(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    n = n * 256 + octet
  }
  return n >>> 0
}

const BLOCKED_V4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['127.0.0.0', 8], // loopback
  ['100.64.0.0', 10], // carrier-grade NAT
  ['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.168.0.0', 16], // private
]

function isBlockedIpv4(address: string): boolean {
  if (address === '169.254.169.254') return true
  const n = parseIpv4(address)
  if (n === null) return true // unparseable → treat as blocked
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0
    return (n & mask) >>> 0 === (parseIpv4(base)! & mask) >>> 0
  })
}

/** Expands an IPv6 literal (incl. `::` and an embedded dotted-quad tail) into 8 groups. */
function expandIpv6(address: string): number[] | null {
  let addr = address.toLowerCase().split('%')[0]!
  const lastColon = addr.lastIndexOf(':')
  const tail = addr.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail)
    if (v4 === null) return null
    addr = `${addr.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const parseHalf = (half: string) => (half === '' ? [] : half.split(':'))
  const left = parseHalf(halves[0]!)
  const right = halves.length === 2 ? parseHalf(halves[1]!) : []
  const fillCount = 8 - left.length - right.length
  if (halves.length === 2 ? fillCount < 0 : fillCount !== 0) return null
  const groups: number[] = []
  for (const part of [
    ...left,
    ...Array<string>(halves.length === 2 ? fillCount : 0).fill('0'),
    ...right,
  ]) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null
    groups.push(Number.parseInt(part, 16))
  }
  return groups.length === 8 ? groups : null
}

function isBlockedIpv6(address: string): boolean {
  const groups = expandIpv6(address.replace(/^\[|\]$/g, ''))
  if (groups === null) return true // unparseable → treat as blocked
  const allZeroPrefix = groups.slice(0, 7).every((g) => g === 0)
  if (allZeroPrefix && (groups[7] === 0 || groups[7] === 1)) return true // :: and ::1
  if ((groups[0]! & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((groups[0]! & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  const isMappedV4 = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff
  if (isMappedV4) {
    const hi = groups[6]!
    const lo = groups[7]!
    const mapped = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
    return isBlockedIpv4(mapped)
  }
  return false
}

export function isBlockedAddress(address: string, family: number): boolean {
  if (family === 4) return isBlockedIpv4(address)
  if (family === 6) return isBlockedIpv6(address)
  return true // unknown family → blocked
}

/** HTTPS-only + resolve the host and refuse private/loopback/link-local/CGN/metadata ranges. */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  lookup: LookupFn = defaultLookup,
): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError('Некорректный URL')
  }
  if (url.protocol !== 'https:') {
    throw new SsrfBlockedError('Только https:// адреса')
  }
  if (url.username !== '' || url.password !== '') {
    throw new SsrfBlockedError('URL не должен содержать учётные данные')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  if (literalFamily !== 0) {
    if (isBlockedAddress(hostname, literalFamily)) {
      throw new SsrfBlockedError('Адрес назначения запрещён')
    }
    return
  }
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new SsrfBlockedError('Не удалось разрешить адрес хоста')
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError('Не удалось разрешить адрес хоста')
  }
  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      throw new SsrfBlockedError('Адрес назначения запрещён')
    }
  }
}
