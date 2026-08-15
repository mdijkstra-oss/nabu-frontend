export interface MarkdownOptions {
  keepHeadings?: boolean
}

// Unicode reserves U+FFFF for internal processing and forbids it in interchange, so a
// document holding one is already malformed. One UTF-16 code unit, which is what keeps
// the marked string the same length as its input.
export const MARK_SENTINEL = "￿"

const BOLD = /\*\*(.+?)\*\*/dg
const ITALIC = /(?<!\*)\*([^*]+?)\*(?!\*)|_([^_]+?)_/dg
const LINK = /\[([^\]]+)\]\([^)]+\)/dg
const HEADING = /^#{1,6}\s+/dgm
const LIST_ITEM = /^[-*+]\s+/dgm
const INLINE_CODE = /`([^`]+)`/dg
const STRIKETHROUGH = /~~(.+?)~~/dg
const IMAGE = /!\[([^\]]*)\]\([^)]+\)/dg
const TABLE_SEPARATOR = /^\|?[\s-:|]+\|[\s-:|]*$/dgm
const TABLE_PIPE = /^\|(.+)\|$/dgm
const NUMBERED_LIST = /^\d+\.\s+/dgm
const BLOCKQUOTE = /^>\s?/dgm

// A period inside a name is not a sentence end, but the segmenter breaks on any period
// followed by a capital, which cuts "Dr. J. Doe" into three sentences and leaves the name
// unquotable from any one of them. Only the period is masked, so the reader still sees it.
// A closed list of titles, because a general "short capitalised word" rule would also join
// "He spoke to Bell. She replied."
const TITLE = /\b(Mr|Mrs|Ms|Dr|Prof|Rev|Hon|Sgt|Lt|Capt|Col|Gen|Fr|Sr|Jr|St)\.(?=\s)/dg
const INITIAL = /\b([A-Z])\.(?=\s+[A-Z])/dg
const DOTTED = /\b([A-Za-z])\.(?=[A-Za-z]\.)/dg

const ABBREVIATIONS = [TITLE, INITIAL, DOTTED]

// A table's pipes and separator rule delimit a row rather than sit inside a sentence, so a
// row that took them back would read with a pipe on each edge. Every other construct the
// segmenter's trim eats belongs to the sentence it was taken from and is recovered.
const ROW_DELIMITERS = [TABLE_SEPARATOR, TABLE_PIPE]

const RECOVERABLE = [
  IMAGE,
  BOLD,
  STRIKETHROUGH,
  LINK,
  INLINE_CODE,
  ITALIC,
  LIST_ITEM,
  NUMBERED_LIST,
  BLOCKQUOTE,
  HEADING,
]

const CONSTRUCTS = [...RECOVERABLE.filter((c) => c !== HEADING), ...ROW_DELIMITERS]

const RECOVERS = new Set([...RECOVERABLE, ...ABBREVIATIONS])

const constructsFor = (options: MarkdownOptions): RegExp[] =>
  options.keepHeadings ? CONSTRUCTS : [...CONSTRUCTS, HEADING]

const capturedOffsets = (indices: RegExpIndicesArray): Set<number> => {
  const kept = new Set<number>()
  for (let group = 1; group < indices.length; group++) {
    const span = indices[group]
    if (!span) continue
    for (let i = span[0]; i < span[1]; i++) kept.add(i)
  }
  return kept
}

// Each construct is read against the original text and its syntax unioned into one mask,
// so no construct can shift the positions another one is matching at and marking a
// character twice is the same as marking it once.
const markConstruct = (text: string, construct: RegExp, mask: boolean[]): void => {
  for (const match of text.matchAll(construct)) {
    if (!match.indices) continue
    const [start, end] = match.indices[0]
    const kept = capturedOffsets(match.indices)
    for (let i = start; i < end; i++) {
      if (!kept.has(i)) mask[i] = true
    }
  }
}

const maskOf = (text: string, constructs: RegExp[]): boolean[] => {
  const mask = new Array<boolean>(text.length).fill(false)
  for (const construct of constructs) markConstruct(text, construct, mask)
  return mask
}

const markdownMask = (text: string, options: MarkdownOptions): boolean[] =>
  maskOf(text, constructsFor(options))

// A sentinel already in the input would be indistinguishable from one this module wrote,
// so it becomes a space first — length-preserving, so nothing downstream can tell.
const guardSentinels = (text: string): string => text.replaceAll(MARK_SENTINEL, " ")

export const markMarkdown = (text: string, options: MarkdownOptions = {}): string => {
  const source = guardSentinels(text)
  const mask = markdownMask(source, options)
  let marked = ""
  for (let i = 0; i < source.length; i++) marked += mask[i] ? MARK_SENTINEL : source[i]
  return marked
}

export const neutralizeMarked = (marked: string): string => marked.replaceAll(MARK_SENTINEL, " ")

export const neutralizeMarkdown = (text: string): string => neutralizeMarked(markMarkdown(text))

export interface NeutralizedText {
  // Markup blanked to spaces of the same width. This is what the segmenter reads.
  text: string
  // True at each markup character a sentence row may take back once the trim has eaten it.
  recoverable: boolean[]
}

export const neutralizeForSplitting = (source: string): NeutralizedText => {
  const guarded = guardSentinels(source)
  const markup = new Array<boolean>(guarded.length).fill(false)
  const recoverable = new Array<boolean>(guarded.length).fill(false)

  for (const construct of [...constructsFor({}), ...ABBREVIATIONS]) {
    markConstruct(guarded, construct, markup)
    if (RECOVERS.has(construct)) markConstruct(guarded, construct, recoverable)
  }

  let text = ""
  for (let i = 0; i < guarded.length; i++) text += markup[i] ? " " : guarded[i]
  return { text, recoverable }
}
