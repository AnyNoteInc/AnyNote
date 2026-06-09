import { describe, it, expect } from 'vitest'

import {
  DEFAULT_FREE_PAGE_HISTORY_DAYS,
  parsePageHistoryDays,
} from '../../../src/billing/dto/billing.dto.ts'

describe('parsePageHistoryDays', () => {
  it('parses "pageHistory:<n>" → n', () => {
    expect(parsePageHistoryDays(['pageHistory:30'], true)).toBe(30)
    expect(parsePageHistoryDays(['pageHistory:30'], false)).toBe(30)
  })

  it('parses "pageHistory:unlimited" → null', () => {
    expect(parsePageHistoryDays(['pageHistory:unlimited'], false)).toBeNull()
    expect(parsePageHistoryDays(['pageHistory:unlimited'], true)).toBeNull()
  })

  it('defaults to null (unlimited) for paid plans when absent', () => {
    expect(parsePageHistoryDays([], true)).toBeNull()
    expect(parsePageHistoryDays(['publicSites'], true)).toBeNull()
  })

  it('defaults to DEFAULT_FREE_PAGE_HISTORY_DAYS for free plans when absent', () => {
    expect(parsePageHistoryDays([], false)).toBe(DEFAULT_FREE_PAGE_HISTORY_DAYS)
    expect(parsePageHistoryDays(['publicSites'], false)).toBe(DEFAULT_FREE_PAGE_HISTORY_DAYS)
    expect(DEFAULT_FREE_PAGE_HISTORY_DAYS).toBe(7)
  })

  it('treats non-array / null features as absent', () => {
    expect(parsePageHistoryDays(null, true)).toBeNull()
    expect(parsePageHistoryDays(null, false)).toBe(DEFAULT_FREE_PAGE_HISTORY_DAYS)
    expect(parsePageHistoryDays(undefined, false)).toBe(DEFAULT_FREE_PAGE_HISTORY_DAYS)
    expect(parsePageHistoryDays('pageHistory:30', false)).toBe(DEFAULT_FREE_PAGE_HISTORY_DAYS)
  })

  it('ignores malformed / non-positive entries and falls back to the default', () => {
    expect(parsePageHistoryDays(['pageHistory:abc'], false)).toBe(DEFAULT_FREE_PAGE_HISTORY_DAYS)
    expect(parsePageHistoryDays(['pageHistory:0'], false)).toBe(DEFAULT_FREE_PAGE_HISTORY_DAYS)
    expect(parsePageHistoryDays(['pageHistory:-5'], false)).toBe(DEFAULT_FREE_PAGE_HISTORY_DAYS)
  })

  it('returns the first valid pageHistory entry', () => {
    expect(parsePageHistoryDays(['pageHistory:14', 'pageHistory:30'], false)).toBe(14)
  })
})
