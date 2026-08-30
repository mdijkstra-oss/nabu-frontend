/**
 * Converts the EPITOME empathy dataset (Sharma et al. 2020, "A Computational
 * Approach to Understanding Empathy Expressed in Text-Based Mental Health
 * Support", https://aclanthology.org/2020.emnlp-main.425/; data at
 * https://github.com/behavioral-data/Empathy-Mental-Health) into a Nabu
 * benchmark project:
 *
 *   <out>/codebook.md          one json-callout code per mechanism × level (6)
 *   <out>/corpus/<sp>-<rp>.md  seeker post + response post + json-attributes
 *
 * Only the Reddit subset is publicly released (the TalkLife half needs a
 * TalkLife license). Mechanism definitions and the weak/strong criteria are
 * embedded verbatim from Section 2 of the paper — the framework the
 * crowdworker annotators were trained on. Level 0 (no communication) carries
 * no code; the paper treats bare advice, bare facts, and abuse as no
 * communication of empathy.
 *
 * A handful of pairs appear twice in the release with disagreeing levels; the
 * higher level wins, rationales of the winning level are merged. Gold
 * rationale highlights are re-anchored to the response text (exact match
 * first, then whitespace/quote-normalized); the rare level>0 row with no
 * rationale or an unanchorable one is dropped and counted.
 *
 * Usage: npx tsx scripts/epitome-to-nabu.ts <epitome-dataset-dir> <output-dir>
 *   where <epitome-dataset-dir> is the repo's `dataset/` directory holding
 *   emotional-reactions-reddit.csv, interpretations-reddit.csv,
 *   explorations-reddit.csv.
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { CalloutSchema, type CalloutBlock } from "~/domain/data-blocks/callout/schema"
import { indexProseSentences, findOverlappingRange } from "~/lib/text/halo"
import { BLOCK_COLORS } from "~/ui/theme/colors"
import { csvRecords } from "./lib/csv"

interface Code {
  title: string
  color: string
  definition: string
}

const EXAMPLE_CONTEXT =
  'All examples respond to the seeker post: "I am about to have an anxiety attack."'

const ER =
  "Expressing emotions such as warmth, compassion, and concern, experienced by the peer supporter after reading the seeker’s post. Expressing these emotions plays an important role in establishing empathic rapport and support."
const INTERP =
  "Communicating an understanding of feelings and experiences inferred from the seeker’s post. Such a cognitive understanding in responses is helpful in increasing awareness of hidden feelings and experiences, and essential for developing alliance between the seeker and peer supporter."
const EXPL =
  "Improving understanding of the seeker by exploring the feelings and experiences not stated in the post. Showing an active interest in what the seeker is experiencing and feeling and probing gently is another important aspect of empathy."

const CODES: Record<string, Code> = {
  "emotional-reactions-weak": {
    title: "Emotional reactions (weak)",
    color: "tomato",
    definition: `${ER}\n\nWeak communication alludes to these emotions without the emotions being explicitly labeled.\n\nEx.: "Everything will be fine." ${EXAMPLE_CONTEXT}`,
  },
  "emotional-reactions-strong": {
    title: "Emotional reactions (strong)",
    color: "red",
    definition: `${ER}\n\nStrong communication specifies the experienced emotions.\n\nEx.: "I feel really sad for you." ${EXAMPLE_CONTEXT}`,
  },
  "interpretations-weak": {
    title: "Interpretations (weak)",
    color: "sky",
    definition: `${INTERP}\n\nWeak communication contains a mention of the understanding.\n\nEx.: "I understand how you feel." ${EXAMPLE_CONTEXT}`,
  },
  "interpretations-strong": {
    title: "Interpretations (strong)",
    color: "blue",
    definition: `${INTERP}\n\nStrong communication specifies the inferred feeling or experience, or communicates understanding through descriptions of similar experiences.\n\nEx.: "This must be terrifying"; "I also have anxiety attacks at times which makes me really terrified." ${EXAMPLE_CONTEXT}`,
  },
  "explorations-weak": {
    title: "Explorations (weak)",
    color: "mint",
    definition: `${EXPL}\n\nA weak exploration is generic.\n\nEx.: "What happened?" ${EXAMPLE_CONTEXT}`,
  },
  "explorations-strong": {
    title: "Explorations (strong)",
    color: "green",
    definition: `${EXPL}\n\nA strong exploration is specific and labels the seeker’s experiences and feelings which the peer supporter wants to explore.\n\nEx.: "Are you feeling alone right now?" ${EXAMPLE_CONTEXT}`,
  },
}

const MECHANISMS = [
  {
    file: "emotional-reactions-reddit.csv",
    label: "Emotional reactions",
    key: "emotional-reactions",
  },
  { file: "interpretations-reddit.csv", label: "Interpretations", key: "interpretations" },
  { file: "explorations-reddit.csv", label: "Explorations", key: "explorations" },
]

// Entity ids are prefix + [0-9][a-z0-9]{7}; derive them from the code key so
// a scoring run can recompute the id-to-label mapping instead of parsing it.
const calloutId = (label: string): string => {
  const hex = createHash("sha256").update(`epitome:${label}`).digest("hex")
  const digit = String(parseInt(hex.slice(0, 2), 16) % 10)
  const rest = BigInt(`0x${hex.slice(2, 16)}`)
    .toString(36)
    .padStart(7, "0")
    .slice(0, 7)
  return `callout-${digit}${rest}`
}

const formatBlock = (language: string, payload: unknown): string =>
  "```" + language + "\n" + JSON.stringify(payload, null, "\t") + "\n```\n"

const dataDir = process.argv[2]
const outDir = process.argv[3]
if (!dataDir || !outDir)
  throw new Error("usage: npx tsx scripts/epitome-to-nabu.ts <epitome-dataset-dir> <output-dir>")

for (const color of Object.values(CODES).map((c) => c.color)) {
  if (!BLOCK_COLORS.includes(color)) throw new Error(`not a block color: ${color}`)
}

mkdirSync(join(outDir, "corpus"), { recursive: true })

const callouts: CalloutBlock[] = Object.entries(CODES).map(([label, code]) => {
  const block = {
    id: calloutId(label),
    type: "codebook-code" as const,
    title: code.title,
    color: code.color,
    collapsed: false,
    content: code.definition,
  }
  const parsed = CalloutSchema.safeParse(block)
  if (!parsed.success) throw new Error(`invalid callout for ${label}: ${parsed.error.message}`)
  return parsed.data
})

const codebook = [
  "# EPITOME empathy mechanisms",
  "",
  "Codebook of the EPITOME gold labels (Reddit subset). Definitions verbatim from Sharma et al. (2020), Section 2 — the framework the annotators were trained on. Each mechanism is coded at the level communicated: weak or strong. No communication of a mechanism carries no code; the paper counts responses that only give advice, only provide factual information, or are offensive as no communication of empathy.",
  "",
  ...callouts.map((c) => formatBlock("json-callout", c)),
].join("\n")
writeFileSync(join(outDir, "codebook.md"), codebook)

interface Pair {
  seeker: string
  response: string
  // per mechanism key: level (1|2) and rationale phrases
  gold: Map<string, { level: number; rationales: string[] }>
}

const pairs = new Map<string, Pair>()
let conflicts = 0
for (const mech of MECHANISMS) {
  const records = csvRecords(readFileSync(join(dataDir, mech.file), "utf-8"))
  for (const r of records) {
    const id = `${r.sp_id}-${r.rp_id}`
    let pair = pairs.get(id)
    if (!pair) {
      pair = { seeker: r.seeker_post, response: r.response_post, gold: new Map() }
      pairs.set(id, pair)
    }
    const level = Number(r.level)
    if (![0, 1, 2].includes(level))
      throw new Error(`bad level ${r.level} in ${mech.file} for ${id}`)
    if (level === 0) continue
    const rationales = r.rationales.split("|").filter((x) => x.trim().length > 0)
    const existing = pair.gold.get(mech.key)
    if (!existing) pair.gold.set(mech.key, { level, rationales })
    else if (existing.level === level) existing.rationales.push(...rationales)
    else {
      conflicts++
      if (level > existing.level) pair.gold.set(mech.key, { level, rationales })
    }
  }
}

// Rationales are verbatim highlights of the response, but ~5% drift on
// whitespace or curly quotes; fall back to a normalized search.
const normChar = (c: string): string =>
  c === "’" || c === "‘" ? "'" : c === "“" || c === "”" ? '"' : /\s/.test(c) ? " " : c.toLowerCase()

const normalize = (s: string): { text: string; map: number[] } => {
  let text = ""
  const map: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = normChar(s[i])
    if (c === " " && (text.length === 0 || text.endsWith(" "))) continue
    text += c
    map.push(i)
  }
  return { text, map }
}

const findRationale = (
  doc: string,
  from: number,
  needle: string
): { start: number; end: number } | null => {
  const exact = doc.indexOf(needle, from)
  if (exact >= 0) return { start: exact, end: exact + needle.length }
  const region = normalize(doc.slice(from))
  const target = normalize(needle).text.trim()
  if (target.length === 0) return null
  const idx = region.text.indexOf(target)
  if (idx < 0) return null
  return {
    start: from + region.map[idx],
    end: from + region.map[idx + target.length - 1] + 1,
  }
}

let unanchored = 0
let noRationale = 0
let annotationCount = 0
let totalRationales = 0
for (const [id, pair] of pairs) {
  const pre = `Seeker post:\n\n${pair.seeker.trim()}\n\nResponse:\n\n`
  const doc = pre + pair.response.trim()
  const rows = indexProseSentences(doc)
  // One annotation per (code, sentence range); rationales of the same code
  // inside one sentence collapse. The exact highlight survives in the reason.
  const seen = new Map<
    string,
    { code: string; label: string; start: number; end: number; texts: string[] }
  >()
  for (const [mechKey, gold] of pair.gold) {
    const codeKey = `${mechKey}-${gold.level === 1 ? "weak" : "strong"}`
    const mech = MECHANISMS.find((m) => m.key === mechKey)
    if (!mech) throw new Error(`unknown mechanism ${mechKey}`)
    const label = `${mech.label}, ${gold.level === 1 ? "weak" : "strong"}`
    if (gold.rationales.length === 0) {
      noRationale++
      continue
    }
    for (const phrase of gold.rationales) {
      totalRationales++
      const span = findRationale(doc, pre.length, phrase)
      if (!span) {
        unanchored++
        continue
      }
      const range = findOverlappingRange(rows, span.start, span.end)
      if (!range) {
        unanchored++
        continue
      }
      const start = rows[range.firstIdx].start
      const end = rows[range.lastIdx].end
      const key = `${codeKey}@${start}-${end}`
      const entry = seen.get(key)
      if (entry) entry.texts.push(phrase)
      else seen.set(key, { code: codeKey, label, start, end, texts: [phrase] })
    }
  }
  const spans = [...seen.values()].sort((a, b) => a.start - b.start)
  annotationCount += spans.length
  const attributes = {
    type: "peer-support-exchange",
    source: "EPITOME (Sharma et al. 2020), Reddit subset",
    subject: pair.seeker.length > 80 ? pair.seeker.slice(0, 77) + "..." : pair.seeker,
  }
  const block = {
    annotations: spans.map((s) => ({
      text: doc.slice(s.start, s.end),
      reason: `Gold (${s.label}) — rationale: ${s.texts.map((t) => JSON.stringify(t.replace(/\s+/g, " ").slice(0, 120))).join(", ")}`,
      code: calloutId(s.code),
      actor: "user" as const,
    })),
  }
  const parsed = AnnotationsBlockSchema.safeParse(block)
  if (!parsed.success) throw new Error(`invalid annotations for ${id}: ${parsed.error.message}`)
  const out =
    doc.trimEnd() +
    "\n\n" +
    formatBlock("json-attributes", attributes) +
    "\n" +
    formatBlock("json-annotations", parsed.data)
  writeFileSync(join(outDir, "corpus", `${id}.md`), out)
}

if (unanchored / totalRationales > 0.05)
  throw new Error(`${unanchored}/${totalRationales} rationales failed to anchor`)

console.log(
  `codebook: ${callouts.length} codes; corpus: ${pairs.size} exchanges; annotations: ${annotationCount}` +
    ` (dropped: ${unanchored} unanchorable rationales, ${noRationale} labels without rationale; ${conflicts} duplicate-row level conflicts resolved to the higher level)`
)
