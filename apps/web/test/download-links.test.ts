import { describe, expect, it } from 'vitest'

import { detectOS, downloadUrl, DESKTOP_PLATFORMS } from '@/lib/download-links'

describe('detectOS', () => {
  it('detects macOS', () => {
    expect(detectOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari')).toBe('mac')
  })
  it('detects Windows', () => {
    expect(detectOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win')
  })
  it('detects Linux (non-Android)', () => {
    expect(detectOS('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
  })
  it('returns null for Android/unknown', () => {
    expect(detectOS('Mozilla/5.0 (Linux; Android 13)')).toBe(null)
    expect(detectOS('weird')).toBe(null)
  })
})

describe('downloadUrl', () => {
  it('builds a GitHub latest-release asset URL per platform', () => {
    expect(downloadUrl('mac')).toBe(
      'https://github.com/AnyNoteInc/AnyNote/releases/latest/download/AnyNote.dmg',
    )
    expect(downloadUrl('win')).toBe(
      'https://github.com/AnyNoteInc/AnyNote/releases/latest/download/AnyNote-Setup.exe',
    )
    expect(downloadUrl('linux')).toBe(
      'https://github.com/AnyNoteInc/AnyNote/releases/latest/download/AnyNote.AppImage',
    )
  })
  it('DESKTOP_PLATFORMS lists all three platforms with labels', () => {
    expect(DESKTOP_PLATFORMS.map((p) => p.id)).toEqual(['mac', 'win', 'linux'])
  })
})
