import { describe, expect, it } from 'vitest'
import { RU } from './ru'

describe('RU.labels.yearsSuffix', () => {
  it('uses год for 1, 21, 31, ...', () => {
    expect(RU.labels.yearsSuffix(1)).toBe('год')
    expect(RU.labels.yearsSuffix(21)).toBe('год')
    expect(RU.labels.yearsSuffix(101)).toBe('год')
  })

  it('uses года for 2-4, 22-24, ...', () => {
    expect(RU.labels.yearsSuffix(2)).toBe('года')
    expect(RU.labels.yearsSuffix(3)).toBe('года')
    expect(RU.labels.yearsSuffix(4)).toBe('года')
    expect(RU.labels.yearsSuffix(22)).toBe('года')
  })

  it('uses лет for 5-20, 25-30, ...', () => {
    expect(RU.labels.yearsSuffix(5)).toBe('лет')
    expect(RU.labels.yearsSuffix(11)).toBe('лет')
    expect(RU.labels.yearsSuffix(12)).toBe('лет')
    expect(RU.labels.yearsSuffix(13)).toBe('лет')
    expect(RU.labels.yearsSuffix(14)).toBe('лет')
    expect(RU.labels.yearsSuffix(15)).toBe('лет')
    expect(RU.labels.yearsSuffix(20)).toBe('лет')
  })
})

describe('RU.labels.yearsOld', () => {
  it('combines number and suffix', () => {
    expect(RU.labels.yearsOld(1)).toBe('1 год')
    expect(RU.labels.yearsOld(2)).toBe('2 года')
    expect(RU.labels.yearsOld(42)).toBe('42 года')
    expect(RU.labels.yearsOld(11)).toBe('11 лет')
  })
})

describe('RU.labels.yearsOldApprox', () => {
  it('prefixes with ~', () => {
    expect(RU.labels.yearsOldApprox(42)).toBe('~42 года')
  })
})

describe('RU.labels.yearsOldRange', () => {
  it('renders range with ~ prefix', () => {
    expect(RU.labels.yearsOldRange(30, 35)).toBe('~30-35')
  })
})
