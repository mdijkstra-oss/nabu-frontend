import type { Annotation as StoredAnnotation } from "~/domain/data-blocks/attributes/schema"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import type { FileStore } from "~/lib/files/store"
import { MAX_REVIEWED_ANNOTATIONS } from "./def"

interface Message {
  type: "message"
  role: "system" | "user"
  content: string
}

interface CodedAnnotation {
  text: string
  reason: string
  file: string
}

interface ReviewedAnnotation extends CodedAnnotation {
  review: string
}

const isForCode = (calloutId: string) => (a: StoredAnnotation) => a.code === calloutId

const hasReviewNote = (a: StoredAnnotation): boolean => a.vote?.review !== undefined

const toReviewedAnnotation = (a: StoredAnnotation, file: string): ReviewedAnnotation => ({
  text: a.text,
  reason: a.reason,
  review: a.vote?.review ?? "",
  file,
})

export const collectReviewedAnnotations = (
  files: FileStore,
  calloutId: string
): ReviewedAnnotation[] => {
  const matchesCode = isForCode(calloutId)
  const result: ReviewedAnnotation[] = []
  for (const [path, raw] of Object.entries(files)) {
    for (const a of getStoredAnnotations(raw)) {
      if (!matchesCode(a) || !hasReviewNote(a)) continue
      result.push(toReviewedAnnotation(a, path))
      if (result.length >= MAX_REVIEWED_ANNOTATIONS) return result
    }
  }
  return result
}

export const collectCleanAnnotations = (
  files: FileStore,
  calloutId: string,
  limit: number
): CodedAnnotation[] => {
  const matchesCode = isForCode(calloutId)
  const result: CodedAnnotation[] = []
  for (const [path, raw] of Object.entries(files)) {
    for (const a of getStoredAnnotations(raw)) {
      if (!matchesCode(a) || hasReviewNote(a)) continue
      result.push({ text: a.text, reason: a.reason, file: path })
      if (result.length >= limit) return result
    }
  }
  return result
}

const formatFlaggedAnnotation = (a: ReviewedAnnotation, idx: number): string =>
  `### Passage ${idx + 1} (${a.file})\n\n> ${a.text}\n\nReason coded: ${a.reason}\nReview note: ${a.review}`

const formatCleanAnnotation = (a: CodedAnnotation, idx: number): string =>
  `### Passage ${idx + 1} (${a.file})\n\n> ${a.text}\n\nReason coded: ${a.reason}`

const formatFlaggedBlock = (annotations: ReviewedAnnotation[]): string =>
  annotations.length === 0
    ? "No flagged annotations found for this code."
    : annotations.map(formatFlaggedAnnotation).join("\n\n---\n\n")

const formatCleanBlock = (annotations: CodedAnnotation[]): string =>
  annotations.length === 0
    ? "No clean annotations found for this code."
    : annotations.map(formatCleanAnnotation).join("\n\n---\n\n")

export const REFINE_CTA =
  "Analyze this code definition against the flagged and clean passages. Identify patterns in the review flags, contrast with clean passages, and suggest how to sharpen the definition."

export const buildRefineMessages = (
  generalCodebook: string,
  codeDefinition: string,
  flagged: ReviewedAnnotation[],
  clean: CodedAnnotation[]
): Message[] => [
  {
    type: "message",
    role: "system",
    content: `<codebook-rules>\n${generalCodebook}\n</codebook-rules>`,
  },
  {
    type: "message",
    role: "system",
    content: `<code-definition>\n${codeDefinition}\n</code-definition>`,
  },
  {
    type: "message",
    role: "system",
    content: `<flagged-passages count="${flagged.length}">\n${formatFlaggedBlock(flagged)}\n</flagged-passages>`,
  },
  {
    type: "message",
    role: "system",
    content: `<clean-passages count="${clean.length}">\n${formatCleanBlock(clean)}\n</clean-passages>`,
  },
  { type: "message", role: "user", content: REFINE_CTA },
]

export const buildInstructionTail = (calloutId: string): string =>
  `---

## Next Steps

Present these findings to the researcher. Be precise about which passages and criteria the analysis references — quote specifics, do not paraphrase.

If the researcher wants to update the code definition:
- Edit the code at \`${calloutId}.generated.hidden.md\` using patch_json_block
- After updating, suggest re-coding affected sections with apply_deep_analysis
`
