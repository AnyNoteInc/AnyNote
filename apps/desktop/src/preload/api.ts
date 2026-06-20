export type AnynoteApi = {
  isDesktop: true
  platform: string
  arch: string
  appVersion: string
}

export function buildAnynoteApi(info: {
  platform: string
  arch: string
  version: string
}): AnynoteApi {
  return Object.freeze({
    isDesktop: true,
    platform: info.platform,
    arch: info.arch,
    appVersion: info.version,
  })
}
