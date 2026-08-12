import type { Message } from "./messages"

export {
  respondingWith,
  textOf,
  hasBreakpoint,
  type FakeParse,
  type RecordedCall,
  type Respond,
} from "~/lib/calls/parse.fixture"
import { textOf } from "~/lib/calls/parse.fixture"

export interface RenderedEntry {
  id: number
  marked: string
}

export const renderedEntriesIn = (messages: Message[]): RenderedEntry[] =>
  messages.flatMap((message) => {
    const text = textOf(message)
    const id = /^<entry id="(\d+)"/.exec(text)
    if (!id) return []
    const marked = /<marked>([\s\S]*?)<\/marked>/.exec(text)
    return [{ id: Number(id[1]), marked: marked?.[1] ?? "" }]
  })
