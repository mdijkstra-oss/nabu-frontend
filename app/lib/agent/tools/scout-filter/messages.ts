interface Message {
  type: "message"
  role: "system" | "user"
  content: string
}

export interface NumberedEntry {
  index: number
  text: string
}

const formatNumberedEntries = (entries: NumberedEntry[]): string =>
  entries.map((e) => `<entry id="${e.index}">\n${e.text}\n</entry>`).join("\n\n")

const CTA = "Return entry numbers to exclude from analysis."

export const buildScoutFilterMessages = (
  framework: string,
  entries: NumberedEntry[]
): Message[] => {
  const messages: Message[] = []
  if (framework.length > 0) {
    messages.push({ type: "message", role: "system", content: framework })
  }
  messages.push({ type: "message", role: "system", content: formatNumberedEntries(entries) })
  messages.push({ type: "message", role: "user", content: CTA })
  return messages
}
