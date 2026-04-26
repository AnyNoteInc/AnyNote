export class YookassaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "YookassaError"
  }
}

export class YookassaApiError extends YookassaError {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "YookassaApiError"
    this.status = status
    this.body = body
  }
}
