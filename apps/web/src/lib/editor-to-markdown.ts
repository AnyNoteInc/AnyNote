import TurndownService from "turndown"

export function editorHtmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  })

  td.addRule("callout", {
    filter: (n) => {
      if (n.nodeName !== "DIV") return false
      const el = n as HTMLElement
      return el.dataset?.type === "callout"
    },
    replacement: (content, node) => {
      const el = node as HTMLElement
      const icon = el.dataset?.emoji ?? el.dataset?.icon ?? "💡"
      return `\n> ${icon} ${content.trim()}\n`
    },
  })

  td.addRule("toggle", {
    filter: (n) => {
      if (n.nodeName !== "DIV") return false
      const el = n as HTMLElement
      return el.dataset?.type === "toggle"
    },
    replacement: (content) => {
      const trimmed = content.trim()
      const lines = trimmed.split("\n").filter((l) => l.length > 0)
      const summary = lines[0] ?? ""
      const body = lines.slice(1).join("\n")
      return `\n<details>\n<summary>${summary}</summary>\n${body}\n</details>\n`
    },
  })

  td.addRule("hiddenText", {
    filter: (n) => {
      if (n.nodeName !== "DIV") return false
      const el = n as HTMLElement
      return el.dataset?.type === "hidden-text"
    },
    replacement: (content) => `<span class="hidden">${content.trim()}</span>`,
  })

  td.addRule("fileAttachment", {
    filter: (n) => {
      if (n.nodeName !== "DIV") return false
      const el = n as HTMLElement
      return el.dataset?.type === "file-attachment"
    },
    replacement: (_content, node) => {
      const el = node as HTMLElement
      const name = el.dataset?.name ?? "file"
      const url = el.dataset?.url ?? el.dataset?.href ?? "#"
      return `[${name}](${url})`
    },
  })

  // Turndown emits two newlines between most blocks for standard markdown.
  // Callers found the extra blank lines noisy — collapse to single newlines
  // (markdown renderers still treat these as paragraph breaks for rendering
  // purposes because of hard line breaks at the block level).
  const raw = td.turndown(html)
  return raw.replace(/\n{2,}/g, "\n").trim() + "\n"
}
