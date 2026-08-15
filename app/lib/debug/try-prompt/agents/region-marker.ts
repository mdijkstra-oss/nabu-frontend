import { readFileSync } from "node:fs"
import { z } from "zod"
import { errorMessage } from "~/lib/utils/error"
import { runMark } from "~/lib/regions/detect/mark"
import { computeWindows } from "~/lib/regions/detect/window"
import type { Hit, Mark, MarkWork } from "~/lib/regions/detect/types"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import { defineAgent, UsageError } from "./types"
import { kindFlag, pathFlag } from "./flags"
import { onlyFileOf, scanDocument, type ScannedDocument } from "./document"
import { regionFinder } from "./region-finder"
import { sectionHeading } from "../report"
import { describeIssues } from "../issues"

const extras = z.object({
  kind: kindFlag,
  hits: pathFlag("region-finder's constructed hits: the bare JSON, or a whole saved report"),
})

const hitSchema = z.object({
  kind: z.string(),
  quote: z.string(),
  hitSentence: z.number().int().min(0),
  value: z.string(),
})

const hitsSchema = z.array(hitSchema)

export const hitsTextOf = (text: string): string => {
  const heading = `\n${sectionHeading(regionFinder.constructedLabel)}\n`
  const at = text.lastIndexOf(heading)
  return at === -1 ? text : text.slice(at + heading.length)
}

export const parseHits = (text: string, source: string): Hit[] => {
  let json: unknown
  try {
    json = JSON.parse(hitsTextOf(text))
  } catch (error) {
    throw new UsageError(`--hits ${source} is not JSON: ${errorMessage(error)}`)
  }
  const parsed = hitsSchema.safeParse(json)
  if (parsed.success) return parsed.data
  throw new UsageError(
    `--hits ${source} is not region-finder's hits: ${describeIssues(parsed.error, fieldOf).join("; ")}`
  )
}

export const readHits = (path: string, kind: KindDescriptor): Hit[] => {
  let text: string
  try {
    text = readFileSync(path, "utf-8")
  } catch (error) {
    throw new UsageError(`--hits ${path} cannot be read: ${errorMessage(error)}`)
  }
  return onlyOfKind(parseHits(text, path), kind, path)
}

const onlyOfKind = (hits: Hit[], kind: KindDescriptor, source: string): Hit[] => {
  const strays = hits.map((hit, i) => [i, hit] as const).filter(([, hit]) => hit.kind !== kind.id)
  if (strays.length === 0) return hits
  const named = strays.map(([i, hit]) => `hits[${i}].kind is "${hit.kind}"`).join(", ")
  throw new UsageError(`--hits ${source} is not for --kind ${kind.id}: ${named}`)
}

export const markWorksOf = (doc: ScannedDocument, hits: Hit[]): MarkWork[] =>
  computeWindows(hits, doc.sentences).map(({ hit, window }) => ({
    file: doc.file,
    sentences: doc.sentences,
    hit,
    window,
  }))

export const regionMarker = defineAgent({
  name: "region-marker",
  summary:
    "mark how far each hit from a region-finder run reaches, one call per batch of stretches",
  input: "file",
  extras,
  constructedLabel: "marks",
  run: async ({ files, extras: { kind, hits } }) => {
    const found = readHits(hits, kind)
    const { file, raw } = onlyFileOf(files)
    const marks: Mark[] = []
    await runMark(markWorksOf(scanDocument(file, raw), found), {
      kind,
      onAnswered: (_, mark) => marks.push(mark),
      onFailed: () => undefined,
    })
    return marks
  },
})

const fieldOf = (path: PropertyKey[]): string =>
  path.reduce<string>(
    (name, key) => (typeof key === "number" ? `${name}[${key}]` : `${name}.${String(key)}`),
    "hits"
  )
