import type { Annotation as StoredAnnotation } from "~/domain/data-blocks/attributes/schema"
import type { CalloutBlock } from "~/domain/data-blocks/callout/schema"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { getAllCodes } from "~/domain/data-blocks/callout/codes/selectors"
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

export const collectOtherCodes = (files: FileStore, calloutId: string): CalloutBlock[] =>
  getAllCodes(files).filter((c) => c.id !== calloutId)

const formatOtherCode = (code: CalloutBlock): string =>
  `### ${code.title} (\`${code.id}\`)\n\n${code.content}`

const formatOtherCodesBlock = (codes: CalloutBlock[]): string =>
  codes.length === 0
    ? "No other codes in the codebook."
    : codes.map(formatOtherCode).join("\n\n---\n\n")

export const REFINE_CTA =
  "Analyze this code definition against the flagged and clean passages. Identify patterns in the review flags, contrast with clean passages, and suggest how to sharpen the definition."

export const buildRefineMessages = (
  codeDefinition: string,
  flagged: ReviewedAnnotation[],
  clean: CodedAnnotation[],
  otherCodes: CalloutBlock[],
  guidance?: string,
  generalCodebook?: string
): Message[] => {
  const messages: Message[] = []

  if (generalCodebook) {
    messages.push({
      type: "message",
      role: "system",
      content: `<codebook-rules>\n${generalCodebook}\n</codebook-rules>`,
    })
  }

  messages.push(
    {
      type: "message",
      role: "system",
      content: `<other-codes count="${otherCodes.length}">\nThese are the other codes in the codebook. Use them to identify boundary overlaps or suggest disambiguation, but do not redefine them.\n\n${formatOtherCodesBlock(otherCodes)}\n</other-codes>`,
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
    }
  )

  const cta = guidance ? `${REFINE_CTA}\n\nAdditional guidance: ${guidance}` : REFINE_CTA
  messages.push({ type: "message", role: "user", content: cta })

  return messages
}

export const buildInstructionTail = (calloutId: string): string =>
  `---

## Next Steps

Present these findings to the researcher. Be precise about which passages and criteria the analysis references — quote specifics, do not paraphrase.

If the analysis suggests specific changes to the code definition, present them as options using the ask tool. Include one option per distinct change, an option to apply all changes together, and an option to discuss further. Do not apply changes without the researcher choosing.

After the researcher selects changes:
1. Edit the code at \`${calloutId}.generated.hidden.md\` using patch_json_block
2. Count existing annotations for \`${calloutId}\`: how many have a vote_review (reviewed) and how many do not (unreviewed)
3. Report both counts and ask the researcher which set to recode (reviewed, unreviewed, both, or skip for now)
4. For the chosen set, call apply_deep_analysis with sections of \`type: "query"\` — use a SQL query against the annotations table filtering by \`code = '${calloutId}'\` and the appropriate vote_review condition
`
