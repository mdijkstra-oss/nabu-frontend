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

## Presenting the findings

Present these findings to the researcher. When you reference a passage or another code, emit its \`id\` only — in the marked form the chat resolves to a link — and do not quote, retype, or paraphrase its text alongside it. The link resolves to the exact passage on its own, so a retyped quote only duplicates it and is the one place text can drift; your own one-line analysis after the link is fine, since that is your words, not the passage. Relay every reference by the exact \`id\` the analysis used; do not rename a code, resolve a name to a different code, or substitute one reference for another. If the analysis names a code only loosely with no callout id, present it as stated and flag the target as unconfirmed — do not pick a code yourself. If the analysis suggests specific changes to the code definition, present them as options using the ask tool: one option per distinct change, an option to apply all changes together, and an option to discuss further. Do not apply changes without the researcher choosing.

## Applying the definition change

After the researcher selects changes, edit the code at \`${calloutId}.generated.hidden.md\` using patch_json_block. Apply only the changes the researcher selected.

When a change adds or replaces an example or counter-example, write the annotation \`id\` the analysis referenced — not passage text. The system expands the id to the annotation's exact text, so do not author, complete, normalize, paraphrase, or retype any passage text. If a proposed example is not backed by an annotation id in the analysis, do not invent one — return to the researcher.

Once the edit is applied, confirm what was changed. You are done.

Do not count annotations, propose recoding, or suggest re-running the code. Editing the definition and recoding the corpus are separate actions — recoding is the researcher's call, made when they choose, and is never a default consequence of an edit. Not every change needs a run.

## If the researcher asks to recode

Only when the researcher explicitly requests it, follow these rules:

1. Count existing annotations for \`${calloutId}\`: how many have a vote_review (reviewed) and how many do not (unreviewed).
2. Report both counts and confirm which set to recode: reviewed, unreviewed, or both. For the chosen set, this code's existing annotations are cleared — the codings around each coded passage (e.g. on the same line) — and the coder runs over those spots again against the updated definition. Each spot may come back coded or not, depending on the new definition and normal run-to-run variation, so the set's annotations for this code are whatever the fresh pass produces.
3. For the chosen set, call apply_deep_analysis with sections of \`type: "query"\` — use a SQL query against the annotations table filtering by \`code = '${calloutId}'\` and the appropriate vote_review condition. Use \`source_files: [{ path: "${calloutId}.generated.hidden.md", scope: "dimension" }]\` — this is the only dimension needed.
`
