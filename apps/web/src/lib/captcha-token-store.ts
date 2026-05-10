let pendingToken: string | null = null

export const setPendingCaptchaToken = (token: string | null): void => {
  pendingToken = token
}

export const consumePendingCaptchaToken = (): string | null => {
  const token = pendingToken
  pendingToken = null
  return token
}
