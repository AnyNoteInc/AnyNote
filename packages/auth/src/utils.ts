import { auth, type Session } from './auth.ts'

export type AuthUser = Session['user']

export async function getUserFromRequest(
  req?: Request,
  resHeaders?: Headers,
): Promise<AuthUser | null> {
  if (!req) {
    return null
  }

  try {
    const result = await auth.api.getSession({
      headers: req.headers,
      returnHeaders: true,
    })

    if (!result) {
      return null
    }

    const setCookie = result.headers?.get('set-cookie')
    if (setCookie && resHeaders) {
      resHeaders.append('set-cookie', setCookie)
    }

    return result.response?.user ?? null
  } catch {
    return null
  }
}
