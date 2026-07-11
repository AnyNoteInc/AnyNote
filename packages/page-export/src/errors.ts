// NB: no constructor parameter properties here — this package is loaded as raw
// .ts by the Node runtime of apps/engines (type stripping), which rejects
// non-erasable syntax (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).

export class GotenbergTimeoutError extends Error {
  constructor() {
    super('Gotenberg request timed out')
    this.name = 'GotenbergTimeoutError'
  }
}

export class GotenbergUpstreamError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`Gotenberg returned ${status}`)
    this.name = 'GotenbergUpstreamError'
    this.status = status
    this.body = body
  }
}

export class GotenbergUnreachableError extends Error {
  constructor(reason: string) {
    super(`Gotenberg unreachable: ${reason}`)
    this.name = 'GotenbergUnreachableError'
  }
}
