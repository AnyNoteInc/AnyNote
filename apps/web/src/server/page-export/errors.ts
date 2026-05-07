export class GotenbergTimeoutError extends Error {
  constructor() {
    super('Gotenberg request timed out')
    this.name = 'GotenbergTimeoutError'
  }
}

export class GotenbergUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Gotenberg returned ${status}`)
    this.name = 'GotenbergUpstreamError'
  }
}

export class GotenbergUnreachableError extends Error {
  constructor(reason: string) {
    super(`Gotenberg unreachable: ${reason}`)
    this.name = 'GotenbergUnreachableError'
  }
}
