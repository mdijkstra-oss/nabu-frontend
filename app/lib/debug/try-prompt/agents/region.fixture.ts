import type { Message } from "~/lib/calls/messages"
import { textOf } from "~/lib/calls/parse.fixture"
import { getKind } from "~/lib/regions/kinds/registry"
import { streamingJson, type Respond, type StubRequest } from "../fetch.fixture"

export interface RenderedOccurrence {
  n: number
  ref: string
  quote: string
}

export interface RenderedEntry {
  id: number
  file: string
  sentences: string[]
  occurrences: RenderedOccurrence[]
}

const ENTRY_OPEN = /<entry id="(\d+)" file="([^"]*)">/
const NUMBERED_LINE = /^\[\d+\.\d+\] (.*)$/
const OCCURRENCE = /<occurrence n="(\d+)" ref="([^"]+)">([^<]*)<\/occurrence>/g
const A_WORD = /\p{L}{3,}/u

export const messageTextsOf = (body: string): string[] =>
  (JSON.parse(body) as { input: Message[] }).input.map(textOf)

export const entriesOf = (body: string): RenderedEntry[] =>
  messageTextsOf(body).flatMap((text) => {
    const open = ENTRY_OPEN.exec(text)
    if (!open) return []
    const lines = text.split("\n")
    return [
      {
        id: Number(open[1]),
        file: open[2],
        sentences: lines.flatMap((line) => NUMBERED_LINE.exec(line)?.[1] ?? []),
        occurrences: [...text.matchAll(OCCURRENCE)].map((match) => ({
          n: Number(match[1]),
          ref: match[2],
          quote: match[3],
        })),
      },
    ]
  })

export const fileAttributesOf = (body: string): string[] =>
  entriesOf(body).map((entry) => entry.file)

export const isForKind = (body: string, kindId: string): boolean =>
  messageTextsOf(body)[0] === getKind(kindId)?.rules

const wordIn = (sentence: string): string | undefined => A_WORD.exec(sentence)?.[0]

// One occurrence per entry, in the entry's own sentence `sentenceNumber` (1-based),
// quoting a word that sentence contains so the gate keeps it.
export const findReply = (sentenceNumber: number, valueOf: (quote: string) => string) => {
  const occurrenceIn = (entry: RenderedEntry) => {
    const number = Math.min(sentenceNumber, entry.sentences.length)
    const quote = wordIn(entry.sentences[number - 1])
    return quote ? [{ quote, ref: `${entry.id}.${number}`, value: valueOf(quote) }] : []
  }
  return (body: string): unknown => ({
    results: entriesOf(body).map((entry) => ({
      entry: entry.id,
      occurrences: occurrenceIn(entry),
    })),
  })
}

export const markReply = (body: string): unknown => ({
  results: entriesOf(body).flatMap((entry) =>
    entry.occurrences.map((occurrence) => ({
      entry: entry.id,
      n: occurrence.n,
      start: occurrence.ref,
      end: occurrence.ref,
    }))
  ),
})

export const lowercased = (quote: string): string => quote.toLowerCase()

export const FIXED_DATE = "2026-03-03"

export const answeringDetect =
  (routes: Record<string, (body: string) => unknown>): Respond =>
  (request: StubRequest) => {
    const endpoint = new URL(request.url).pathname
    const reply = routes[endpoint]
    if (!reply) throw new Error(`no stub route for ${endpoint}`)
    return streamingJson(reply(request.body))
  }

export const HIT_SENTENCE_NUMBER = 2

export const findReplyByKind = (body: string): unknown =>
  isForKind(body, "date")
    ? findReply(HIT_SENTENCE_NUMBER, () => FIXED_DATE)(body)
    : findReply(HIT_SENTENCE_NUMBER, lowercased)(body)
