export function parseUserAgent(ua: string | null | undefined): { browser: string; os: string } {
  if (!ua) return { browser: 'Unknown', os: 'Unknown' }
  const desktop = /AnyNote-Desktop\/[\d.]+\s*\((\w+);/.exec(ua)
  if (desktop) {
    const platform = desktop[1]
    const os =
      platform === 'darwin'
        ? 'macOS'
        : platform === 'win32'
          ? 'Windows'
          : platform === 'linux'
            ? 'Linux'
            : 'Unknown'
    return { browser: 'AnyNote Desktop', os }
  }
  const browser = /Edg/.test(ua)
    ? 'Edge'
    : /Chrome/.test(ua)
      ? 'Chrome'
      : /Firefox/.test(ua)
        ? 'Firefox'
        : /Safari/.test(ua)
          ? 'Safari'
          : 'Unknown'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown'
  return { browser, os }
}
