import { NextResponse, type NextRequest } from "next/server"

import { prisma } from "@repo/db"

import { getSession } from "@/lib/get-session"
import { activeStreamRegistry } from "@/lib/chat/active-stream-registry"
import { encodeSseEvent } from "@/lib/chat/sse"
import type { StreamStatus } from "@/lib/chat/types"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assistantMessageId: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { assistantMessageId } = await params
  const message = await prisma.chatMessage.findFirst({
    where: {
      id: assistantMessageId,
      role: "ASSISTANT",
      chat: {
        workspace: {
          members: {
            some: { userId: session.user.id },
          },
        },
      },
    },
    select: {
      id: true,
      status: true,
      errorMessage: true,
    },
  })
  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 })
  }

  const entry = activeStreamRegistry.get(assistantMessageId)
  if (!entry) {
    const terminalStatus: StreamStatus = message.status === "ERROR" ? "ERROR" : "DONE"

    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encodeSseEvent({
              type: "message.status",
              assistantMessageId,
              status: terminalStatus,
              errorMessage: terminalStatus === "ERROR" ? (message.errorMessage ?? undefined) : undefined,
            }),
          )
          controller.enqueue(
            encodeSseEvent({
              type: "message.done",
              assistantMessageId,
            }),
          )
          controller.close()
        },
      }),
      {
        headers: {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
        },
      },
    )
  }

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encodeSseEvent({
            type: "message.status",
            assistantMessageId,
            status: entry.status,
            errorMessage: entry.errorMessage,
          }),
        )

        if (entry.blocks.length > 0) {
          controller.enqueue(
            encodeSseEvent({
              type: "message.service",
              assistantMessageId,
              blocks: entry.blocks,
            }),
          )
        }

        let unsubscribe = () => {}
        unsubscribe = entry.subscribe((event) => {
          controller.enqueue(encodeSseEvent(event))
          if (event.type === "message.done") {
            unsubscribe()
            controller.close()
          }
        })

        return () => unsubscribe()
      },
    }),
    {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      },
    },
  )
}
