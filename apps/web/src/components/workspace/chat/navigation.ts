type RouterLike = {
  push: (href: string, options?: { scroll?: boolean }) => void
}

export function buildChatHref(chatId: string) {
  return `/chats/${chatId}`
}

export function navigateToChat(router: RouterLike, chatId: string) {
  router.push(buildChatHref(chatId), { scroll: false })
}
