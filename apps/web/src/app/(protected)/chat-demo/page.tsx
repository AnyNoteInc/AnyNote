import { notFound } from "next/navigation"
import { ChatDemoClient } from "./chat-demo-client"

export default function ChatDemoPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <ChatDemoClient />
}
