import { markMarkdown, MARK_SENTINEL, type MarkdownOptions } from "./mark"

export const stripMarkdown = (text: string, options: MarkdownOptions = {}): string =>
  markMarkdown(text, options).replaceAll(MARK_SENTINEL, "")
