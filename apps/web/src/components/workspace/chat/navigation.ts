type RouterLike = {
  push: (href: string, options?: { scroll?: boolean }) => void
}

export function buildChatHref(workspaceId: string, chatId: string) {
  return `/workspaces/${workspaceId}/chats/${chatId}`
}

export function navigateToChat(router: RouterLike, workspaceId: string, chatId: string) {
  router.push(buildChatHref(workspaceId, chatId), { scroll: false })
}
