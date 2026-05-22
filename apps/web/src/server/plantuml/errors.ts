export class PlantumlTimeoutError extends Error {
  constructor() {
    super('PlantUML request timed out')
    this.name = 'PlantumlTimeoutError'
  }
}

export class PlantumlUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`PlantUML server returned ${status}`)
    this.name = 'PlantumlUpstreamError'
  }
}

export class PlantumlUnreachableError extends Error {
  constructor(reason: string) {
    super(`PlantUML server unreachable: ${reason}`)
    this.name = 'PlantumlUnreachableError'
  }
}
