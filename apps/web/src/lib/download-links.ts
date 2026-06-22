export type DesktopOS = 'mac' | 'win' | 'linux'

// Binaries are served locally from apps/web/public/downloads/ (populated by the
// desktop `dist` build via scripts/copy-to-web.mjs), not from GitHub releases.
const RELEASE_BASE = '/downloads'

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
