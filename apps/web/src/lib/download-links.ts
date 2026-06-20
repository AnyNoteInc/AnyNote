export type DesktopOS = 'mac' | 'win' | 'linux'

const RELEASE_BASE = 'https://github.com/AnyNoteInc/AnyNote/releases/latest/download'

const ASSET: Record<DesktopOS, string> = {
  mac: 'AnyNote.dmg',
  win: 'AnyNote-Setup.exe',
  linux: 'AnyNote.AppImage',
}

export const DESKTOP_PLATFORMS: { id: DesktopOS; label: string }[] = [
  { id: 'mac', label: 'macOS' },
  { id: 'win', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
]

export function downloadUrl(os: DesktopOS): string {
  return `${RELEASE_BASE}/${ASSET[os]}`
}

export function detectOS(ua: string): DesktopOS | null {
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'win'
  if (/Android/.test(ua)) return null
  if (/Linux/.test(ua)) return 'linux'
  return null
}
