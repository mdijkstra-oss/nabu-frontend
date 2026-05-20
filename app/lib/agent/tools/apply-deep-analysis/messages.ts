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
import { GENERATED_SUFFIX } from "~/lib/files/filename"
import { prepareTargetContent, numberSection } from "./format"
import { cacheMarker } from "../../client/call-parse"

interface Message {
  type: "message"
  role: "system" | "user"
  content: string
}

export interface ScopedSources {
  framework: string[]
  dimension: string[]
}

export const singleIdFindSchema = z.object({
  results: z.array(
    z.object({
      start: z.number().int().min(1),
      end: z.number().int().min(1),
      reasonToKeep: z.string(),
    })
  ),
})

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

const toCalloutPath = (id: string): string => `${id}${GENERATED_SUFFIX}`

export const expandDimensions = (
  sources: ScopedSources,
  resolve: ContentResolver
): ScopedSources => {
  const expanded: string[] = []
  for (const path of sources.dimension) {
    const raw = resolve(path)
    if (!raw) {
      expanded.push(path)
      continue
    }
    const callouts = getCallouts(raw)
    if (callouts.length === 0) {
      expanded.push(path)
      continue
    }
    for (const c of callouts) expanded.push(toCalloutPath(c.id))
  }
  return { framework: sources.framework, dimension: expanded }
}

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

const resolvePathMessages = (paths: string[], resolve: ContentResolver): Message[] =>
  paths.reduce<Message[]>((msgs, path) => {
    const content = resolveSource(path, resolve)
    return content ? [...msgs, { type: "message", role: "system", content }] : msgs
  }, [])

export const buildSourceMessages = (
  { framework, dimension }: ScopedSources,
  resolve: ContentResolver
): Message[] => resolvePathMessages([...framework, ...dimension], resolve)

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

const FIND_CTA =
  "Analyze the numbered sentences against the source definition. Return matching spans as JSON."

export const FILTER_CTA =
  "For each coded section, judge whether the passage satisfies the code definitions. Return your judgment as JSON."

export const buildFilterSchema = (validCodes: string[]) =>
  z.object({
    results: z.array(
      z.object({
        id: z.number().int().min(1),
        code: validCodes.length > 0 ? z.enum(validCodes as [string, ...string[]]) : z.string(),
        judgment: z.enum(["remove", "keep"]),
        reason: z.string(),
      })
    ),
  })

const buildFindEnvelope = (
  frameworkMessages: Message[],
  section: string,
  leadingCtx: string,
  trailingCtx: string,
  dimensionMessages: Message[],
  callToAction: string
): Message[] => {
  const messages: Message[] = [...frameworkMessages]
  messages.push(cacheMarker())
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
  messages.push(cacheMarker())
  messages.push(...dimensionMessages)
  messages.push({ type: "message", role: "user", content: callToAction })
  return messages
}

export const buildFindMessages = (
  numbered: string,
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Message[] =>
  buildFindEnvelope(
    resolvePathMessages(sources.framework, resolve),
    numbered,
    leadingCtx,
    trailingCtx,
    resolvePathMessages(sources.dimension, resolve),
    FIND_CTA
  )

const buildSpanEnvelope = (
  frameworkMessages: Message[],
  section: string,
  leadingCtx: string,
  trailingCtx: string,
  calloutMessages: Message[],
  callToAction: string
): Message[] => {
  const messages: Message[] = [...frameworkMessages]
  messages.push(cacheMarker())
  messages.push(...calloutMessages)
  messages.push(cacheMarker())
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

export const buildSpanStepMessages = (
  presented: string,
  codeIds: ReadonlySet<string>,
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver,
  callToAction: string
): Message[] =>
  buildSpanEnvelope(
    resolvePathMessages(sources.framework, resolve),
    presented,
    leadingCtx,
    trailingCtx,
    buildCodeSourceMessages(codeIds, { framework: [], dimension: sources.dimension }, resolve),
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
