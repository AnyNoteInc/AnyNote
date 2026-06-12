import { describe, expect, it } from 'vitest'

import { isDomainError } from '../../src/shared/errors.ts'
import {
  BILLING_AUDIT_ACTIONS,
  SEATS_ERROR_CODES,
  buildSeatRenewalOrderMetadata,
  isValidInn,
  isValidKpp,
  parseSeatRenewalOrderMetadata,
  prorateSeatPurchase,
  seatsError,
} from '../../src/seats/dto/seats.dto.ts'
import type { OwnerSeatCharge } from '../../src/seats/dto/seats.dto.ts'

// Pure table test for the proration formula (spec §3/§7.4):
//   max(1, ceil(seats × seatPriceKopecks × remainingMs / periodMs))
// remainingMs ≤ 0 ⇒ PERIOD_ENDED refusal; now before periodStart clamps to the
// full period (never charges MORE than the full price). No Date.now inside —
// the caller passes `now`, so every row here is deterministic.

const MONTH_START = '2026-06-01T00:00:00.000Z' // 30-day month
const MONTH_END = '2026-07-01T00:00:00.000Z'
const YEAR_START = '2026-01-01T00:00:00.000Z' // 365-day year (2026 is not a leap year)
const YEAR_END = '2027-01-01T00:00:00.000Z'

interface Row {
  name: string
  seats: number
  periodStart: string
  periodEnd: string
  now: string
  seatPriceKopecks: number
  expected: number
}

const rows: Row[] = [
  {
    name: 'mid-period: exactly half of a 30-day month',
    seats: 1,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-06-16T00:00:00.000Z', // 15 of 30 days remaining
    seatPriceKopecks: 19000,
    expected: 9500,
  },
  {
    name: 'same-day purchase (now = periodStart) charges the full price',
    seats: 1,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: MONTH_START,
    seatPriceKopecks: 19000,
    expected: 19000,
  },
  {
    name: 'day one of the period ≈ full remaining (29/30, ceil)',
    seats: 1,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-06-02T00:00:00.000Z',
    seatPriceKopecks: 19000,
    expected: 18367, // ceil(19000 × 29/30 = 18366.67)
  },
  {
    name: 'last day of the month',
    seats: 1,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-06-30T00:00:00.000Z', // 1 of 30 days remaining
    seatPriceKopecks: 19000,
    expected: 634, // ceil(19000/30 = 633.33)
  },
  {
    name: 'final hour of the period still charges (ceil ≥ 1 share)',
    seats: 1,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-06-30T23:00:00.000Z', // 3 600 000 ms remaining
    seatPriceKopecks: 19000,
    expected: 27, // ceil(19000 × 3.6e6/2.592e9 = 26.39)
  },
  {
    name: 'multi-seat mid-month',
    seats: 3,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-06-16T00:00:00.000Z',
    seatPriceKopecks: 19000,
    expected: 28500, // 3 × 9500, no rounding
  },
  {
    name: 'multi-seat ceil rounding edge',
    seats: 7,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-06-21T00:00:00.000Z', // 10 of 30 days remaining
    seatPriceKopecks: 19000,
    expected: 44334, // ceil(7 × 19000 × 10/30 = 44333.33)
  },
  {
    name: 'year period, mid-year',
    seats: 1,
    periodStart: YEAR_START,
    periodEnd: YEAR_END,
    now: '2026-07-01T00:00:00.000Z', // 184 of 365 days remaining
    seatPriceKopecks: 190000,
    expected: 95781, // ceil(190000 × 184/365 = 95780.82)
  },
  {
    name: 'year period, multi-seat near the end',
    seats: 5,
    periodStart: YEAR_START,
    periodEnd: YEAR_END,
    now: '2026-12-02T00:00:00.000Z', // 30 of 365 days remaining
    seatPriceKopecks: 190000,
    expected: 78083, // ceil(5 × 190000 × 30/365 = 78082.19)
  },
  {
    name: 'exact division leaves no rounding artifact',
    seats: 1,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-06-21T00:00:00.000Z', // 10 of 30 days remaining
    seatPriceKopecks: 30000,
    expected: 10000,
  },
  {
    name: 'clamp: now before periodStart charges exactly the full period, never more',
    seats: 1,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-05-31T00:00:00.000Z',
    seatPriceKopecks: 19000,
    expected: 19000,
  },
  {
    name: 'minimum 1 kopeck: one millisecond remaining at the cheapest price',
    seats: 1,
    periodStart: MONTH_START,
    periodEnd: MONTH_END,
    now: '2026-06-30T23:59:59.999Z',
    seatPriceKopecks: 1,
    expected: 1,
  },
  {
    // 50 × 290000 × 364d-in-ms ≈ 4.56e17 — far past MAX_SAFE_INTEGER (≈9.0e15);
    // the BigInt path must produce the hand-computed exact value:
    // ceil(14 500 000 × 364/365) = ceil(5 278 000 000 / 365) = 14 460 274.
    name: 'max scale: 50 seats × yearly price on day one of a 365-day period (BigInt-exact)',
    seats: 50,
    periodStart: YEAR_START,
    periodEnd: YEAR_END,
    now: '2026-01-02T00:00:00.000Z', // 364 of 365 days remaining
    seatPriceKopecks: 290000,
    expected: 14460274,
  },
  {
    // Real subscription periods carry millisecond timestamps. Numerator
    // 425 736 063 085 500 000 ≡ periodMs−2 (mod 31 536 000 001), so the true
    // quotient is 13 500 001.999 999 999 94 ⇒ ceil 13 500 002. The float
    // version loses the product's low bits (4.26e17 > 2^53) and lands just
    // ABOVE the integer: Math.ceil gives 13 500 003 — a 1-kopeck overcharge.
    name: 'max scale, ms-granular period: float math overcharges by 1 kopeck, BigInt is exact',
    seats: 50,
    periodStart: YEAR_START,
    periodEnd: '2027-01-01T00:00:00.001Z', // 365 days + 1 ms
    now: '2026-01-26T04:08:12.202Z', // 29 361 107 799 ms remaining
    seatPriceKopecks: 290000,
    expected: 13500002,
  },
]

describe('prorateSeatPurchase', () => {
  it.each(rows)('$name', ({ seats, periodStart, periodEnd, now, seatPriceKopecks, expected }) => {
    expect(
      prorateSeatPurchase({
        seats,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        now: new Date(now),
        seatPriceKopecks,
      }),
    ).toBe(expected)
  })

  function expectPeriodEnded(fn: () => unknown) {
    try {
      fn()
    } catch (e) {
      if (!isDomainError(e)) throw e
      expect(e.code).toBe(SEATS_ERROR_CODES.PERIOD_ENDED)
      expect(e.httpStatus).toBe(409)
      return
    }
    throw new Error('expected PERIOD_ENDED, but the call returned')
  }

  it('refuses when now = periodEnd (zero remaining)', () => {
    expectPeriodEnded(() =>
      prorateSeatPurchase({
        seats: 1,
        periodStart: new Date(MONTH_START),
        periodEnd: new Date(MONTH_END),
        now: new Date(MONTH_END),
        seatPriceKopecks: 19000,
      }),
    )
  })

  it('refuses when now is past periodEnd', () => {
    expectPeriodEnded(() =>
      prorateSeatPurchase({
        seats: 1,
        periodStart: new Date(MONTH_START),
        periodEnd: new Date(MONTH_END),
        now: new Date('2026-07-15T00:00:00.000Z'),
        seatPriceKopecks: 19000,
      }),
    )
  })

  it('never exceeds the full per-period price: result ≤ seats × price at max scale', () => {
    // Property sweep at the overflowing scale (50 × 290000 × yearly): whatever
    // `now` is (ms-jittered ends included, pre-start clamp included), the
    // prorated amount stays within [1, seats × seatPriceKopecks].
    const seats = 50
    const seatPriceKopecks = 290000
    const cap = seats * seatPriceKopecks
    const ends = [YEAR_END, '2027-01-01T00:00:00.001Z', '2026-12-31T17:42:11.337Z']
    const nows = [
      '2025-12-31T23:59:59.999Z', // before periodStart — clamps to the full period
      YEAR_START,
      '2026-01-02T00:00:00.000Z',
      '2026-01-26T04:08:12.202Z',
      '2026-07-15T13:13:13.131Z',
      '2026-12-30T23:59:59.998Z',
    ]
    for (const periodEnd of ends) {
      for (const now of nows) {
        const amount = prorateSeatPurchase({
          seats,
          periodStart: new Date(YEAR_START),
          periodEnd: new Date(periodEnd),
          now: new Date(now),
          seatPriceKopecks,
        })
        expect(amount).toBeGreaterThanOrEqual(1)
        expect(amount).toBeLessThanOrEqual(cap)
      }
    }
  })

  it('refuses a degenerate period (periodEnd ≤ periodStart)', () => {
    expectPeriodEnded(() =>
      prorateSeatPurchase({
        seats: 1,
        periodStart: new Date(MONTH_END),
        periodEnd: new Date(MONTH_START),
        now: new Date('2026-05-15T00:00:00.000Z'),
        seatPriceKopecks: 19000,
      }),
    )
  })
})

describe('seats dto catalogs (spec §2)', () => {
  it('audit catalog covers exactly the five spec actions', () => {
    expect(Object.values(BILLING_AUDIT_ACTIONS).sort()).toEqual(
      [
        'seats.purchased',
        'seats.reduction_scheduled',
        'seats.renewal_applied',
        'seats.addons_reset',
        'invoice.requested',
      ].sort(),
    )
  })

  it('error codes carry honest Russian messages and statuses', () => {
    for (const code of Object.values(SEATS_ERROR_CODES)) {
      const err = seatsError(code)
      expect(err.code).toBe(code)
      expect(err.httpStatus).toBeGreaterThanOrEqual(400)
      expect(err.message.length).toBeGreaterThan(0)
    }
    expect(seatsError('NOT_SUBSCRIPTION_OWNER').httpStatus).toBe(403)
    expect(seatsError('SEATS_NOT_AVAILABLE').httpStatus).toBe(403)
    expect(seatsError('PERIOD_ENDED').httpStatus).toBe(409)
    expect(seatsError('REDUCTION_BELOW_USAGE').httpStatus).toBe(409)
    expect(seatsError('INVALID_INN').httpStatus).toBe(400)
    expect(seatsError('INVALID_KPP').httpStatus).toBe(400)
    expect(seatsError('INVOICE_SEATS_BELOW_USAGE').httpStatus).toBe(400)
  })

  it('validates INN as exactly 10 or 12 digits', () => {
    expect(isValidInn('1234567890')).toBe(true)
    expect(isValidInn('123456789012')).toBe(true)
    expect(isValidInn('123456789')).toBe(false) // 9
    expect(isValidInn('12345678901')).toBe(false) // 11
    expect(isValidInn('1234567890123')).toBe(false) // 13
    expect(isValidInn('12345678ab')).toBe(false)
    expect(isValidInn('')).toBe(false)
  })

  it('validates KPP as exactly 9 digits', () => {
    expect(isValidKpp('123456789')).toBe(true)
    expect(isValidKpp('12345678')).toBe(false)
    expect(isValidKpp('1234567890')).toBe(false)
    expect(isValidKpp('12345678a')).toBe(false)
  })
})

// The charged==applied contract (group review Fix 4): the renewal producer
// snapshots the charge rows into Order.metadata; both completion paths apply
// EXACTLY those rows. The parser mirrors parseSeatPurchaseOrderMetadata:
// null for foreign/missing metadata, a LOUD throw for a kind-matching but
// malformed payload (silently recomputing would un-pin charged==applied).
describe('seat-renewal order metadata (spec §4.2 — charged == applied)', () => {
  const charge: OwnerSeatCharge = {
    totalSeatKopecks: 38000,
    perWorkspace: [
      {
        workspaceId: 'ws-1',
        effectiveSeats: 2,
        seatKopecks: 38000,
        memberCount: 4,
        includedSeats: 5,
        paidSeats: 3,
        scheduledSeats: 2,
      },
    ],
  }

  it('round-trips build → parse', () => {
    const metadata = buildSeatRenewalOrderMetadata(charge)
    expect(metadata).toEqual({ kind: 'seat_renewal', rows: charge.perWorkspace })
    // Through a JSON round-trip (Order.metadata is a Json column).
    expect(parseSeatRenewalOrderMetadata(JSON.parse(JSON.stringify(metadata)))).toEqual(metadata)
  })

  it('returns null for missing/foreign metadata (tier and seat-purchase orders)', () => {
    expect(parseSeatRenewalOrderMetadata(null)).toBeNull()
    expect(parseSeatRenewalOrderMetadata(undefined)).toBeNull()
    expect(parseSeatRenewalOrderMetadata({})).toBeNull()
    expect(
      parseSeatRenewalOrderMetadata({ kind: 'seat_purchase', workspaceId: 'ws-1', seats: 2 }),
    ).toBeNull()
  })

  it('throws on a kind-matching but malformed payload', () => {
    expect(() => parseSeatRenewalOrderMetadata({ kind: 'seat_renewal' })).toThrow()
    expect(() => parseSeatRenewalOrderMetadata({ kind: 'seat_renewal', rows: [{}] })).toThrow()
    expect(() =>
      parseSeatRenewalOrderMetadata({
        kind: 'seat_renewal',
        rows: [{ workspaceId: 'ws-1', effectiveSeats: 'two' }],
      }),
    ).toThrow()
  })

  it('treats an absent scheduledSeats as null (older snapshots stay parseable)', () => {
    const raw = JSON.parse(JSON.stringify(buildSeatRenewalOrderMetadata(charge))) as {
      rows: Record<string, unknown>[]
    }
    delete raw.rows[0]!.scheduledSeats
    const parsed = parseSeatRenewalOrderMetadata(raw)
    expect(parsed?.rows[0]?.scheduledSeats).toBeNull()
  })
})
