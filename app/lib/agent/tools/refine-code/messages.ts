import type { Annotation as StoredAnnotation } from "~/domain/data-blocks/attributes/schema"
import type { CalloutBlock } from "~/domain/data-blocks/callout/schema"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { getAllCodes } from "~/domain/data-blocks/callout/codes/selectors"
import type { FileStore } from "~/lib/files/store"
import { extractProse } from "~/lib/data-blocks/parse"
import { stripMarkdown } from "~/lib/text/strip"
import { splitBySentences } from "~/lib/text/split"
import { formatTaggedSection, locateTextInSentences, type CodedItem } from "~/lib/text/present"
import { MAX_REVIEWED_ANNOTATIONS } from "./def"

interface Message {
  type: "message"
  role: "system" | "user"
  content: string
}

interface CodedAnnotation {
  id: string
  text: string
  reason: string
  file: string
}

interface ReviewedAnnotation extends CodedAnnotation {
  review: string
}

const isForCode = (calloutId: string) => (a: StoredAnnotation) => a.code === calloutId

const hasReviewNote = (a: StoredAnnotation): boolean => a.vote?.review !== undefined
const hasVoteBlock = (a: StoredAnnotation): boolean => a.vote !== undefined

const toReviewedAnnotation = (a: StoredAnnotation, file: string): ReviewedAnnotation => ({
  id: a.id,
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
      if (!matchesCode(a) || !hasVoteBlock(a) || hasReviewNote(a)) continue
      result.push({ id: a.id, text: a.text, reason: a.reason, file: path })
      if (result.length >= limit) return result
    }
  }
  return result
}

const PASSAGE_CONTEXT_SENTENCES = 3

const splitSentenceTexts = splitBySentences()

const prepareProse = (raw: string): string =>
  stripMarkdown(extractProse(raw), { keepHeadings: true })

const toSentences = (raw: string): string[] =>
  splitSentenceTexts(prepareProse(raw)).map((s) => s.text)

const formatPassageWithContext = (
  annotation: CodedAnnotation,
  calloutId: string,
  fileSentences: Map<string, string[]>,
  files: FileStore,
  idx: number
): string => {
  const sentences = getOrCreateSentences(annotation.file, fileSentences, files)
  const located = sentences.length > 0 ? locateTextInSentences(sentences, annotation.text) : null

  if (!located) {
    return formatPassageFallback(annotation, idx)
  }

  const item: CodedItem = {
    start: located.start,
    end: located.end,
    codings: [calloutId],
    id: annotation.id,
  }
  const text = formatTaggedSection(sentences, [item], PASSAGE_CONTEXT_SENTENCES)
  return `### Passage ${idx + 1} (${annotation.file})\n\n${text}`
}

const getOrCreateSentences = (
  file: string,
  cache: Map<string, string[]>,
  files: FileStore
): string[] => {
  const cached = cache.get(file)
  if (cached) return cached
  const raw = files[file]
  const sentences = raw ? toSentences(raw) : []
  cache.set(file, sentences)
  return sentences
}

const formatPassageFallback = (a: CodedAnnotation, idx: number): string =>
  `### Passage ${idx + 1} (${a.file})\n\n> ${a.text}`

const formatFlaggedAnnotation = (
  a: ReviewedAnnotation,
  calloutId: string,
  fileSentences: Map<string, string[]>,
  files: FileStore,
  idx: number
): string => {
  const passage = formatPassageWithContext(a, calloutId, fileSentences, files, idx)
  return `${passage}\n\nReason coded: ${a.reason}\nReview note: ${a.review}`
}

const formatCleanAnnotation = (
  a: CodedAnnotation,
  calloutId: string,
  fileSentences: Map<string, string[]>,
  files: FileStore,
  idx: number
): string => {
  const passage = formatPassageWithContext(a, calloutId, fileSentences, files, idx)
  return `${passage}\n\nReason coded: ${a.reason}`
}

const formatFlaggedBlock = (
  annotations: ReviewedAnnotation[],
  calloutId: string,
  files: FileStore
): string => {
  if (annotations.length === 0) return "No flagged annotations found for this code."
  const fileSentences = new Map<string, string[]>()
  return annotations
    .map((a, i) => formatFlaggedAnnotation(a, calloutId, fileSentences, files, i))
    .join("\n\n---\n\n")
}

const formatCleanBlock = (
  annotations: CodedAnnotation[],
  calloutId: string,
  files: FileStore
): string => {
  if (annotations.length === 0) return "No clean annotations found for this code."
  const fileSentences = new Map<string, string[]>()
  return annotations
    .map((a, i) => formatCleanAnnotation(a, calloutId, fileSentences, files, i))
    .join("\n\n---\n\n")
}

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
  calloutId: string,
  files: FileStore,
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
      content: `<flagged-passages count="${flagged.length}">\n${formatFlaggedBlock(flagged, calloutId, files)}\n</flagged-passages>`,
    },
    {
      type: "message",
      role: "system",
      content: `<clean-passages count="${clean.length}">\n${formatCleanBlock(clean, calloutId, files)}\n</clean-passages>`,
    }
  )

  const cta = guidance ? `${REFINE_CTA}\n\nAdditional guidance: ${guidance}` : REFINE_CTA
  messages.push({ type: "message", role: "user", content: cta })

  return messages
}

const formatAnnotationRow = (a: CodedAnnotation, status: "flagged" | "clean"): string => {
  const truncated = a.text.length > 60 ? a.text.slice(0, 57) + "..." : a.text
  return `| ${a.id} | ${a.file} | ${status} | ${truncated} |`
}

export const buildAnnotationIndex = (
  flagged: readonly CodedAnnotation[],
  clean: readonly CodedAnnotation[]
): string => {
  const header = "## Annotation Index\n\n| id | file | status | text |\n|---|---|---|---|"
  const flaggedRows = flagged.map((a) => formatAnnotationRow(a, "flagged"))
  const cleanRows = clean.map((a) => formatAnnotationRow(a, "clean"))
  return [header, ...flaggedRows, ...cleanRows].join("\n")
}

export const buildInstructionTail = (calloutId: string): string =>
  `---

## Your task: turn each finding into a decision the researcher rules on

The researcher has already read the analysis above. Do not restate, summarize, or re-narrate it, and do not quote passages or name codes from it. Your job is to put the decision in front of them — not a menu of fixes to approve.

For each finding, use the ask tool to pose the underlying question the finding raises, with the possible rulings as the options. The option the researcher picks is their ruling on the substance; you turn that ruling into definition wording afterward. A boundary-ambiguity finding becomes something like:

> Does naming an existing rule count as specifying it?
>
> - No — require stating the rule's content (would reclassify these N, incl. the clean one)
> - Yes — naming counts; the definition stands
> - Discuss

### Building these:

- One question per finding. Do not bundle findings into a single "apply all" option — separate findings are separate rulings.
- Frame the options as the competing answers to the question (which way the boundary goes), not as fixes ("sharpen the boundary"). The researcher decides the substance; the wording is your job, not theirs.
- The question and the rulings come from the finding itself — do not invent a decision the analysis did not raise, or drop one it did.
- Where a ruling has a consequence, state it briefly in the option (what it would reclassify or exclude, including any clean passage).
- Always include a "Discuss" option.

Do not apply anything until the researcher rules.

## Applying the ruling

Once the researcher has ruled, translate the ruling into the edit: edit the code at \`${calloutId}.generated.hidden.md\` using patch_json_block. Apply only what their ruling entails.

When a change adds or replaces an example or counter-example, write the annotation \`id\` the analysis referenced — not passage text. The system expands the id to the annotation's exact text, so do not author, complete, normalize, paraphrase, or retype any passage text. If a proposed example is not backed by an annotation id in the analysis, do not invent one — return to the researcher.

Once the edit is applied, confirm what was changed. You are done — stop there.

Do not mention, offer, propose, or ask about recoding or re-running the code, even in passing, and do not initiate it yourself or count/inspect annotations. Recoding is a separate step the researcher takes deliberately and elsewhere, once they have finished refining; raising it here would pull them into that loop too early, so leave it unsaid.
`
