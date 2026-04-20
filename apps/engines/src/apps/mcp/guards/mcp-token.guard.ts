import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common"

@Injectable()
export class McpTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
    const header = req.headers.authorization
    const expected = process.env.ENGINES_MCP_TOKEN
    if (!expected) throw new UnauthorizedException("Unauthorized: MCP token not configured")
    if (!header) throw new UnauthorizedException("Unauthorized: missing Authorization header")
    if (!header.startsWith("Bearer "))
      throw new UnauthorizedException("Unauthorized: Bearer prefix required")
    const token = header.slice(7)
    if (token !== expected) throw new UnauthorizedException("Unauthorized: invalid token")
    return true
  }
}
