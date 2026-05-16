import { z } from "zod"
import type { SourceFile } from "./def"
import {
  stripBlocksByLanguage,
  toDeepSourceContent,
  type ToDeepSourceFn,
} from "~/lib/data-blocks/parse"
import { stripBoundaryComments } from "~/lib/patch/resolve/json-boundary"
import { calloutToDeepSource } from "~/domain/data-blocks/callout/definition"
import { getCallouts } from "~/domain/data-blocks/callout/selectors"
import { prepareTargetContent, numberSection } from "./format"

interface Message {
  type: "message"
  role: "system" | "user"
  content: string
}

export interface ScopedSources {
  framework: string[]
  dimension: string[]
}

export const buildFindResultSchema = (validIds: string[]) =>
  z.object({
    results: z.array(
      z.object({
        start: z.number().int().min(1),
        end: z.number().int().min(1),
        analysis_source_id:
          validIds.length > 0 ? z.enum(validIds as [string, ...string[]]) : z.string(),
        reasonToKeep: z.string(),
      })
    ),
  })

export const partitionSources = (files: SourceFile[]): ScopedSources => ({
  framework: files.filter((f) => f.scope === "framework").map((f) => f.path),
  dimension: files.filter((f) => f.scope === "dimension").map((f) => f.path),
})

export const buildCallList = ({ framework, dimension }: ScopedSources): ScopedSources[] =>
  dimension.length === 0
    ? [{ framework, dimension: [] }]
    : dimension.map((p) => ({ framework, dimension: [p] }))

export type ContentResolver = (path: string) => string | undefined

const SINGLETON_LANGUAGES = ["json-attributes", "json-annotations", "json-settings"]

const stripSingletons = (content: string): string =>
  SINGLETON_LANGUAGES.reduce((acc, lang) => stripBlocksByLanguage(acc, lang), content)

const deepSourceConverters: Record<string, ToDeepSourceFn> = {
  "json-callout": calloutToDeepSource,
}

const prepareSourceContent = (raw: string): string =>
  toDeepSourceContent(stripSingletons(stripBoundaryComments(raw)), deepSourceConverters)

const resolveSource = (path: string, resolve: ContentResolver): string | null => {
  const raw = resolve(path)
  if (raw === undefined) return null
  const content = prepareSourceContent(raw)
  return content || null
}

export const extractSourceIds = (
  { framework, dimension }: ScopedSources,
  resolve: ContentResolver
): string[] =>
  [...framework, ...dimension].flatMap((path) => {
    const raw = resolve(path)
    return raw ? getCallouts(raw).map((c) => c.id) : []
  })

export const buildSourceTitleMap = (
  { framework, dimension }: ScopedSources,
  resolve: ContentResolver
): Map<string, string> => {
  const map = new Map<string, string>()
  for (const path of [...framework, ...dimension]) {
    const raw = resolve(path)
    if (raw) for (const c of getCallouts(raw)) map.set(c.id, c.title)
  }
  return map
}

export const buildSourceMessages = (
  { framework, dimension }: ScopedSources,
  resolve: ContentResolver
): Message[] =>
  [...framework, ...dimension].reduce<Message[]>((msgs, path) => {
    const content = resolveSource(path, resolve)
    return content ? [...msgs, { type: "message", role: "system", content }] : msgs
  }, [])

export const buildCodeSourceMessages = (
  codeIds: ReadonlySet<string>,
  { framework, dimension }: ScopedSources,
  resolve: ContentResolver
): Message[] => {
  const messages: Message[] = []
  for (const path of [...framework, ...dimension]) {
    const raw = resolve(path)
    if (!raw) continue
    for (const callout of getCallouts(raw)) {
      if (!codeIds.has(callout.id)) continue
      const content = calloutToDeepSource(callout)
      if (content) messages.push({ type: "message", role: "system", content })
    }
  }
  return messages
}

const buildSectionMessage = (section: string): string => `<target>\n${section}\n</target>`

const buildLeadingContextMessage = (context: string): string =>
  `<context type="preceding">\n${context}\n</context>`

const buildTrailingContextMessage = (context: string): string =>
  `<context type="following">\n${context}\n</context>`

const buildEnvelope = (
  sourceMessages: Message[],
  section: string,
  leadingCtx: string,
  trailingCtx: string,
  callToAction: string
): Message[] => {
  const messages: Message[] = [...sourceMessages]
  if (leadingCtx) {
    messages.push({
      type: "message",
      role: "system",
      content: buildLeadingContextMessage(leadingCtx),
    })
  }
  messages.push({ type: "message", role: "system", content: buildSectionMessage(section) })
  if (trailingCtx) {
    messages.push({
      type: "message",
      role: "system",
      content: buildTrailingContextMessage(trailingCtx),
    })
  }
  messages.push({ type: "message", role: "user", content: callToAction })
  return messages
}

const FIND_CTA =
  "Analyze the numbered sentences against the source definitions. Return matching spans as JSON."

export const REASON_CTA =
  "For each coded section, provide a one-sentence reason why it matches the assigned code. Return results as JSON."

export const FILTER_CTA =
  "For each coded section, judge whether the passage satisfies the code definition. Return only items that fail. Return results as JSON."

export const ADJUDICATE_CTA =
  "For each coded section, judge whether the passage satisfies the code definition. Return your judgment as JSON."

export const buildFilterSchema = (validCodes: string[]) =>
  z.object({
    results: z.array(
      z.object({
        id: z.number().int().min(1),
        code: validCodes.length > 0 ? z.enum(validCodes as [string, ...string[]]) : z.string(),
        removalJustification: z.string(),
      })
    ),
  })

export const buildAdjudicateSchema = (validCodes: string[]) =>
  z.object({
    results: z.array(
      z.object({
        id: z.number().int().min(1),
        code: validCodes.length > 0 ? z.enum(validCodes as [string, ...string[]]) : z.string(),
        judgment: z.enum(["remove", "keep", "ambiguous"]),
        reason: z.string(),
      })
    ),
  })

export const buildFindMessages = (
  numbered: string,
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Message[] =>
  buildEnvelope(buildSourceMessages(sources, resolve), numbered, leadingCtx, trailingCtx, FIND_CTA)

export const buildSpanStepMessages = (
  presented: string,
  codeIds: ReadonlySet<string>,
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver,
  callToAction: string
): Message[] =>
  buildEnvelope(
    buildCodeSourceMessages(codeIds, sources, resolve),
    presented,
    leadingCtx,
    trailingCtx,
    callToAction
  )

export interface FindCallResult {
  messages: Message[]
  sentences: string[]
}

export const buildFindCall = (
  rawTarget: string,
  sources: ScopedSources,
  resolve: ContentResolver,
  leadingCtx = "",
  trailingCtx = ""
): FindCallResult => {
  const section = prepareTargetContent(rawTarget)
  const { sentences, numbered } = numberSection(section)
  const messages = buildFindMessages(numbered, sources, leadingCtx, trailingCtx, resolve)
  return { messages, sentences }
}
