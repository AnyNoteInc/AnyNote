import { ProxyAgent, type Dispatcher } from 'undici'

let cachedProxy: { url: string; dispatcher: Dispatcher } | undefined

export function telegramProxyDispatcher(
  // This package intentionally reads the deployment-only proxy boundary directly.
  raw = process.env['TELEGRAM_PROXY_URL'],
): Dispatcher | undefined {
  const value = raw?.trim()
  if (!value) return undefined

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Invalid TELEGRAM_PROXY_URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Unsupported TELEGRAM_PROXY_URL protocol')
  }

  if (cachedProxy?.url === url.href) return cachedProxy.dispatcher

  const dispatcher = new ProxyAgent(url.href)
  cachedProxy = { url: url.href, dispatcher }
  return dispatcher
}
