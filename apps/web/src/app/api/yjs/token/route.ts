import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@repo/auth"

import { getSession } from "@/lib/get-session"

export const runtime = "nodejs"

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await auth.api.getToken({ headers: req.headers })
  if (!result?.token) {
    return NextResponse.json({ error: "Token issuance failed" }, { status: 500 })
  }
  return NextResponse.json({ token: result.token })
}
