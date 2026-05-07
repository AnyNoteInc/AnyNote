declare module 'sendsay-api' {
  export type SendsayOptions = {
    apiUrl?: string
    apiKey?: string
    auth?: { login: string; sublogin?: string; password: string }
  }

  export default class Sendsay {
    constructor(opts?: SendsayOptions)
    request(payload: Record<string, unknown>): Promise<unknown>
    setSession(session: string): void
    setSessionFromCookie(cookieName?: string): void
  }
}
