import { type CanActivate, Injectable } from '@nestjs/common'

/**
 * Guard that only allows requests through when PLAYWRIGHT=true is set in the
 * environment. This ensures the test-only indexer trigger endpoint is a no-op
 * in production even if the route is accidentally reachable.
 */
@Injectable()
export class PlaywrightGuard implements CanActivate {
  canActivate(): boolean {
    return process.env.PLAYWRIGHT === 'true'
  }
}
