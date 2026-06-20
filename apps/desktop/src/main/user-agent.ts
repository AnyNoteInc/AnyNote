export type DesktopInfo = { version: string; platform: string; arch: string }

export function buildDesktopUserAgent(base: string, info: DesktopInfo): string {
  return `${base} AnyNote-Desktop/${info.version} (${info.platform}; ${info.arch})`
}
