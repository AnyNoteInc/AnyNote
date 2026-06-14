import { handleInlineAi } from './handler'

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  return handleInlineAi(req)
}
