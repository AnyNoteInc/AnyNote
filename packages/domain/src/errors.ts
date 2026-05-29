export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export const notFound = (message: string): DomainError => new DomainError('NOT_FOUND', message, 404)
export const forbidden = (message: string): DomainError => new DomainError('FORBIDDEN', message, 403)
export const badRequest = (message: string): DomainError => new DomainError('BAD_REQUEST', message, 400)
export const conflict = (message: string): DomainError => new DomainError('CONFLICT', message, 409)

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof Error && e.name === 'DomainError'
}
