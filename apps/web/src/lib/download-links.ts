export type DesktopOS = 'mac' | 'win' | 'linux'

export const DESKTOP_PLATFORMS: { id: DesktopOS; label: string }[] = [
  { id: 'mac', label: 'macOS' },
  { id: 'win', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
]

// The installer is streamed from S3 (uploaded by the Desktop CI) through the
// `/api/download/[os]` proxy route — the repo/releases are private, so we can't
// link GitHub release assets for anonymous visitors.
export function downloadUrl(os: DesktopOS): string {
  return `/api/download/${os}`
}

export function detectOS(ua: string): DesktopOS | null {
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'win'
  if (/Android/.test(ua)) return null
  if (/Linux/.test(ua)) return 'linux'
  return null
}
