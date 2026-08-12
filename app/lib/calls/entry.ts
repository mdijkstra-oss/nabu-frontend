import { z } from "zod"
import { markCacheBreakpoint, type Message } from "./messages"
import { toSystem, toUser } from "~/lib/agent/client/convert"

// The one shape a model sees when it is shown many things at once, and the ref
// scheme that routes its answer back. Everything here is pure.

export interface EntryChild {
  tag: string
  attributes?: Record<string, string>
  body: string
}

// A decorator is the renderer's own markup wrapping a caller's raw text; the
// renderer defuses the text without touching the tag.
export interface Decorator {
  tag: string
  body: string
}

export type PlainSegment = string | Decorator

// plain: for sites whose answers address the entry as a whole.
// numbered: for sites whose answers reach inside an entry, one sentence per line.
export type EntryContent = { plain: PlainSegment[] } | { numbered: string[] }

export interface EntryInput<T> {
  item: T
  file: string
  children?: EntryChild[]
  content: EntryContent
}

// id is an ordinal local to the call, assigned after packing, never by the
// caller; nothing downstream may store one.
export interface Entry<T> extends EntryInput<T> {
  id: number
}

export const assignIds = <T>(inputs: readonly EntryInput<T>[]): Entry<T>[] =>
  inputs.map((input, i) => ({ ...input, id: i + 1 }))

export const renderEntry = (
  entry: Entry<unknown>,
  envelopeTags: readonly string[] = declaredTags([entry])
): string =>
  [
    `<entry id="${entry.id}" file="${escapeAttribute(entry.file)}">`,
    ...(entry.children ?? []).map((child) => renderChild(child, envelopeTags)),
    ...renderContent(entry, envelopeTags),
    "</entry>",
  ].join("\n")

// The packer's sizeOf: the entry as it will actually render, id-independent.
export const entrySize = (entryInput: EntryInput<unknown>): number =>
  renderEntry({ ...entryInput, id: 1 }).length

export interface CallShape {
  stable: Message[]
  volatile?: Message[]
  callToAction: string
}

// Stable preamble (breakpoint on its last message), volatile preamble unmarked,
// one system message per entry, the call-to-action as the final user message.
export const buildEntryMessages = <T>(
  shape: CallShape,
  entries: readonly Entry<T>[]
): Message[] => {
  const envelopeTags = declaredTags(entries)
  return [
    ...markCacheBreakpoint(shape.stable),
    ...(shape.volatile ?? []),
    ...entries.map((entry) => toSystem(renderEntry(entry, envelopeTags))),
    toUser(shape.callToAction),
  ]
}

export interface ResolvedRef<T> {
  entry: Entry<T>
  sentenceIndex: number
}

// `3.7` names sentence 7 of entry 3, both 1-based; the result's sentenceIndex is
// 0-based. Malformed, out-of-call and out-of-bounds refs resolve to nothing and
// are dropped, never repaired.
export const resolveRef = <T>(ref: string, entries: readonly Entry<T>[]): ResolvedRef<T> | null => {
  if (!REF_PATTERN.test(ref)) return null
  const [entryId, sentenceNumber] = ref.split(".").map(Number)
  if (entryId < 1 || sentenceNumber < 1) return null
  const entry = entries.find((candidate) => candidate.id === entryId)
  if (!entry || !("numbered" in entry.content)) return null
  if (sentenceNumber > entry.content.numbered.length) return null
  return { entry, sentenceIndex: sentenceNumber - 1 }
}

// Anchored so `3-7` and `x3.7y` fail at the schema layer (one retry, then the
// call classifies unanswered) instead of becoming silent per-span drops.
export const REF_PATTERN = /^\d+\.\d+$/

export const refString = (): z.ZodString => z.string().regex(REF_PATTERN)

const ENVELOPE_ELEMENTS = ["entry", "occurrence"]

const declaredTags = (entries: readonly Entry<unknown>[]): string[] => {
  const tags = new Set(ENVELOPE_ELEMENTS)
  for (const entry of entries) {
    for (const child of entry.children ?? []) tags.add(child.tag)
    if ("plain" in entry.content) {
      for (const segment of entry.content.plain) {
        if (typeof segment !== "string") tags.add(segment.tag)
      }
    }
  }
  return [...tags]
}

const renderChild = (child: EntryChild, envelopeTags: readonly string[]): string => {
  const attributes = Object.entries(child.attributes ?? {})
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("")
  return `<${child.tag}${attributes}>${defuse(child.body, envelopeTags)}</${child.tag}>`
}

const renderContent = (entry: Entry<unknown>, envelopeTags: readonly string[]): string[] => {
  if ("numbered" in entry.content) {
    return entry.content.numbered.map(
      (sentence, i) => `[${entry.id}.${i + 1}] ${defuse(sentence, envelopeTags)}`
    )
  }
  return entry.content.plain.map((segment) =>
    typeof segment === "string"
      ? defuse(segment, envelopeTags)
      : `<${segment.tag}>${defuse(segment.body, envelopeTags)}</${segment.tag}>`
  )
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const defuse = (text: string, envelopeTags: readonly string[]): string => {
  const names = envelopeTags.map(escapeForRegex).join("|")
  const tagLike = new RegExp(`<(?=/?(?:${names})[\\s/>])`, "g")
  return text.replace(tagLike, "‹")
}
