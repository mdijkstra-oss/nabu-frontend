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
import type { MessageContent } from "../../client/convert"

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

export interface ScopedSources {
  framework: string[]
  dimension: string[]
}

export const partitionSources = (files: SourceFile[]): ScopedSources => ({
  framework: files.filter((f) => f.scope === "framework").map((f) => f.path),
  dimension: files.filter((f) => f.scope === "dimension").map((f) => f.path),
})

export const validateFrameworkNoCallouts = (
  frameworkPaths: string[],
  resolve: ContentResolver
): string | null => {
  for (const path of frameworkPaths) {
    const raw = resolve(path)
    if (!raw) continue
    const callouts = getCallouts(raw)
    if (callouts.length > 0) {
      const ids = callouts.map((c) => c.id).join(", ")
      return `Framework file mismatch: ${path} contains callout IDs [${ids}] — framework files must not contain callout blocks when annotating as code. Check which files should be framework vs dimension.`
    }
  }
  return null
}

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

export const extractDimensionIds = (
  calls: readonly ScopedSources[],
  resolve: ContentResolver
): string[] =>
  calls.flatMap(({ dimension }) =>
    dimension.flatMap((path) => {
      const raw = resolve(path)
      return raw ? getCallouts(raw).map((c) => c.id) : []
    })
  )

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

export const FILTER_CTA =
  "For each coded section, judge whether the passage satisfies the code definitions. Return your judgment as JSON."

export const ADJUDICATE_CTA =
  "For each contested passage, render a verdict: keep, reject, or inconsistent. Return your verdicts as JSON."

// `results` wrapper — some providers reject a top-level JSON array as structured output.
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

// `results` wrapper — some providers reject a top-level JSON array as structured output.
export const buildAdjudicateSchema = (validCodes: string[]) =>
  z.object({
    results: z.array(
      z.object({
        id: z.number().int().min(1),
        code: validCodes.length > 0 ? z.enum(validCodes as [string, ...string[]]) : z.string(),
        judgment: z.enum(["keep", "reject", "inconsistent"]),
        reason: z.string(),
      })
    ),
  })

const buildTargetMessages = (
  targetBlocks: string[],
  codeIds: ReadonlySet<string>,
  sources: ScopedSources,
  resolve: ContentResolver,
  callToAction: string
): Message[] => {
  const messages: Message[] = markCacheBreakpoint(resolvePathMessages(sources.framework, resolve))
  messages.push(
    ...markCacheBreakpoint(
      buildCodeSourceMessages(codeIds, { framework: [], dimension: sources.dimension }, resolve)
    )
  )
  for (const block of targetBlocks) {
    messages.push({ type: "message", role: "system", content: block })
  }
  messages.push({ type: "message", role: "user", content: callToAction })
  return messages
}

export const buildFilterMessages = buildTargetMessages
export const buildAdjudicateMessages = buildTargetMessages
