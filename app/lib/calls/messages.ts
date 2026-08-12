import type { MessageContent } from "~/lib/agent/client/convert"

export interface Message {
  type: "message"
  role: "system" | "user"
  content: MessageContent
}

const textOf = (content: MessageContent): string =>
  typeof content === "string" ? content : content.map((part) => part.text).join("")

// The cached prefix ends at the last message, so the breakpoint rides on its
// final content part. Nothing preceding means nothing to cache.
export const markCacheBreakpoint = (messages: Message[]): Message[] => {
  const last = messages.at(-1)
  if (!last) return messages
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      content: [
        {
          type: "input_text",
          text: textOf(last.content),
          prompt_cache_breakpoint: { mode: "explicit" },
        },
      ],
    },
  ]
}
