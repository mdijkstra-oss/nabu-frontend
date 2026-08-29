/**
 * Converts the SemEval-2020 Task 11 release (PTC corpus v2, Zenodo record
 * 3952415, `datasets-v2.tgz`) into a Nabu benchmark project:
 *
 *   <out>/codebook.md          one json-callout code per gold label (14)
 *   <out>/corpus/<article>.md  train article text verbatim + json-attributes
 *
 * Technique definitions are embedded verbatim from Section 2 of Da San
 * Martino et al. (2019), "Fine-Grained Analysis of Propaganda in News
 * Articles" (https://aclanthology.org/D19-1565/) — the definitions the gold
 * annotators worked from. Labels merged by the task organizers (see the
 * dataset README) get the definitions of all member techniques.
 *
 * Usage: npx tsx scripts/ptc-to-nabu.ts <ptc-datasets-dir> <output-dir>
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { CalloutSchema, type CalloutBlock } from "~/domain/data-blocks/callout/schema"
import { indexProseSentences, findOverlappingRange } from "~/lib/text/halo"
import { BLOCK_COLORS } from "~/ui/theme/colors"

interface Code {
  title: string
  color: string
  definition: string
}

// Gold labels exactly as spelled in train-task2-TC.labels.
const CODES: Record<string, Code> = {
  Loaded_Language: {
    title: "Loaded language",
    color: "tomato",
    definition:
      'Using words/phrases with strong emotional implications (positive or negative) to influence an audience.\n\nEx.: "[...] a lone lawmaker’s childish shouting."',
  },
  "Name_Calling,Labeling": {
    title: "Name calling or labeling",
    color: "red",
    definition:
      'Labeling the object of the propaganda campaign as either something the target audience fears, hates, finds undesirable or otherwise loves or praises.\n\nEx.: "Republican congressweasels", "Bush the Lesser."',
  },
  Repetition: {
    title: "Repetition",
    color: "pink",
    definition:
      "Repeating the same message over and over again, so that the audience will eventually accept it.",
  },
  "Exaggeration,Minimisation": {
    title: "Exaggeration or minimization",
    color: "plum",
    definition:
      'Either representing something in an excessive manner: making things larger, better, worse (e.g., "the best of the best", "quality guaranteed") or making something seem less important or smaller than it actually is, e.g., saying that an insult was just a joke.\n\nEx.: "Democrats bolted as soon as Trump’s speech ended in an apparent effort to signal they can’t even stomach being in the same room as the president"; "I was not fighting with her; we were just playing."',
  },
  Doubt: {
    title: "Doubt",
    color: "purple",
    definition:
      'Questioning the credibility of someone or something.\n\nEx.: A candidate says about his opponent: "Is he ready to be the Mayor?"',
  },
  "Appeal_to_fear-prejudice": {
    title: "Appeal to fear/prejudice",
    color: "violet",
    definition:
      'Seeking to build support for an idea by instilling anxiety and/or panic in the population towards an alternative, possibly based on preconceived judgments.\n\nEx.: "stop those refugees; they are terrorists."',
  },
  "Flag-Waving": {
    title: "Flag-waving",
    color: "indigo",
    definition:
      'Playing on strong national feeling (or with respect to a group, e.g., race, gender, political preference) to justify or promote an action or idea.\n\nEx.: "entering this war will make us have a better future in our country."',
  },
  Causal_Oversimplification: {
    title: "Causal oversimplification",
    color: "blue",
    definition:
      'Assuming one cause when there are multiple causes behind an issue. We include scapegoating as well: the transfer of the blame to one person or group of people without investigating the complexities of an issue.\n\nEx.: "If France had not declared war on Germany, World War II would have never happened."',
  },
  Slogans: {
    title: "Slogans",
    color: "cyan",
    definition:
      'A brief and striking phrase that may include labeling and stereotyping. Slogans tend to act as emotional appeals.\n\nEx.: "Make America great again!"',
  },
  Appeal_to_Authority: {
    title: "Appeal to authority",
    color: "teal",
    definition:
      "Stating that a claim is true simply because a valid authority/expert on the issue supports it, without any other supporting evidence. We include the special case where the reference is not an authority/expert, although it is referred to as testimonial in the literature.",
  },
  "Black-and-White_Fallacy": {
    title: "Black-and-white fallacy, dictatorship",
    color: "jade",
    definition:
      'Presenting two alternative options as the only possibilities, when in fact more possibilities exist. As an extreme case, telling the audience exactly what actions to take, eliminating any other possible choice (dictatorship).\n\nEx.: "You must be a Republican or Democrat; you are not a Democrat. Therefore, you must be a Republican"; "There is no alternative to war."',
  },
  "Thought-terminating_Cliches": {
    title: "Thought-terminating cliché",
    color: "green",
    definition:
      'Words or phrases that discourage critical thought and meaningful discussion about a given topic. They are typically short, generic sentences that offer seemingly simple answers to complex questions or that distract attention away from other lines of thought.\n\nEx.: "it is what it is"; "you cannot judge it without experiencing it"; "it’s common sense"; "nothing is permanent except change"; "better late than never"; "mind your own business"; "nobody’s perfect"; "it doesn’t matter"; "you can’t change human nature."',
  },
  "Whataboutism,Straw_Men,Red_Herring": {
    title: "Whataboutism, straw man, red herring",
    color: "amber",
    definition:
      'Whataboutism: Discredit an opponent’s position by charging them with hypocrisy without directly disproving their argument. For example, mentioning an event that discredits the opponent: "What about ...?"\n\nStraw man: When an opponent’s proposition is substituted with a similar one which is then refuted in place of the original.\n\nRed herring: Introducing irrelevant material to the issue being discussed, so that everyone’s attention is diverted away from the points made. Those subjected to a red herring argument are led away from the issue that had been the focus of the discussion and urged to follow an observation or claim that may be associated with the original claim, but is not highly relevant to the issue in dispute.\n\nEx.: "You may claim that the death penalty is an ineffective deterrent against crime — but what about the victims of crime? How do you think surviving family members feel when they see the man who murdered their son kept in prison at their expense? Is it right that they should pay for their son’s murderer to be fed and housed?"',
  },
  "Bandwagon,Reductio_ad_hitlerum": {
    title: "Bandwagon, reductio ad Hitlerum",
    color: "orange",
    definition:
      'Bandwagon: Attempting to persuade the target audience to join in and take the course of action because "everyone else is taking the same action".\n\nReductio ad Hitlerum: Persuading an audience to disapprove an action or idea by suggesting that the idea is popular with groups hated in contempt by the target audience. It can refer to any person or concept with a negative connotation.\n\nEx.: "Would you vote for Clinton as president? 57% say yes."; "Only one kind of person can think this way: a communist."',
  },
}

// Entity ids are prefix + [0-9][a-z0-9]{7}; derive them from the gold label so
// a scoring run can recompute the id-to-label mapping instead of parsing it.
const calloutId = (label: string): string => {
  const hex = createHash("sha256").update(`ptc:${label}`).digest("hex")
  const digit = String(parseInt(hex.slice(0, 2), 16) % 10)
  const rest = BigInt(`0x${hex.slice(2, 16)}`)
    .toString(36)
    .padStart(7, "0")
    .slice(0, 7)
  return `callout-${digit}${rest}`
}

const formatBlock = (language: string, payload: unknown): string =>
  "```" + language + "\n" + JSON.stringify(payload, null, "\t") + "\n```\n"

const ptcDir = process.argv[2]
const outDir = process.argv[3]
if (!ptcDir || !outDir)
  throw new Error("usage: npx tsx scripts/ptc-to-nabu.ts <ptc-datasets-dir> <output-dir>")

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
  "# PTC propaganda techniques",
  "",
  "Codebook of the SemEval-2020 Task 11 gold labels. Definitions verbatim from Da San Martino et al. (2019), Section 2 — the definitions the corpus annotators worked from.",
  "",
  ...callouts.map((c) => formatBlock("json-callout", c)),
].join("\n")
writeFileSync(join(outDir, "codebook.md"), codebook)

// Gold rows: article, label, start, end, text — where text is sliced from the
// exact article string written into the corpus, so quotes always re-anchor.
const labelLines = readFileSync(join(ptcDir, "train-task2-TC.labels"), "utf-8")
  .split("\n")
  .filter(Boolean)

// PTC offsets count Unicode code points (they were produced with Python tooling);
// JS strings index UTF-16 code units, so any article with astral characters
// (emoji) shifts. Convert on read.
const codePointToUnit = (text: string): number[] => {
  const map: number[] = []
  let unit = 0
  for (const ch of text) {
    map.push(unit)
    unit += ch.length
  }
  map.push(unit)
  return map
}

const articles = new Map<string, string>()
for (const file of readdirSync(join(ptcDir, "train-articles"))) {
  const id = file.replace(/^article/, "").replace(/\.txt$/, "")
  articles.set(id, readFileSync(join(ptcDir, "train-articles", file), "utf-8"))
}

interface GoldSentence {
  label: string
  spanText: string
  sentenceStart: number
  sentenceEnd: number
  sentenceText: string
}

// The annotators' span boundaries carry most of their disagreement (γ ≈ 0.3),
// so the gold unit here is the sentence: every sentence a span touches is
// truth for that span's label. Original offsets are kept alongside.
const sentenceIndex = new Map<string, ReturnType<typeof indexProseSentences>>()
const offsetMaps = new Map<string, number[]>()
for (const [id, text] of articles) {
  sentenceIndex.set(id, indexProseSentences(text))
  offsetMaps.set(id, codePointToUnit(text))
}

const goldByArticle = new Map<string, GoldSentence[]>()
let badSlices = 0
for (const line of labelLines) {
  const [article, label, startRaw, endRaw] = line.split("\t")
  const text = articles.get(article)
  if (!text) throw new Error(`labels reference missing article ${article}`)
  if (!(label in CODES)) throw new Error(`unknown gold label ${label}`)
  const map = offsetMaps.get(article)
  if (!map) throw new Error(`missing offset map for article ${article}`)
  const start = map[Number(startRaw)]
  const end = map[Number(endRaw)]
  if (start === undefined || end === undefined)
    throw new Error(`offset out of range in article ${article}: ${startRaw}-${endRaw}`)
  const span = text.slice(start, end)
  if (span.trim().length === 0) badSlices++
  const rows = sentenceIndex.get(article)
  if (!rows) throw new Error(`missing sentence index for article ${article}`)
  const range = findOverlappingRange(rows, start, end)
  if (!range)
    throw new Error(`gold span outside any sentence in article ${article} at ${start}-${end}`)
  const sentenceStart = rows[range.firstIdx].start
  const sentenceEnd = rows[range.lastIdx].end
  const sentenceText = text.slice(sentenceStart, sentenceEnd)
  const spans = goldByArticle.get(article) ?? []
  spans.push({ label, spanText: span, sentenceStart, sentenceEnd, sentenceText })
  goldByArticle.set(article, spans)
}
if (badSlices > 0)
  throw new Error(`${badSlices} gold spans sliced to empty text — offsets misaligned`)

for (const [id, text] of articles) {
  const title = text.split("\n", 1)[0].trim()
  const attributes = {
    type: "news-article",
    source: "SemEval-2020 Task 11 (PTC corpus)",
    subject: title.length > 80 ? title.slice(0, 77) + "..." : title,
  }
  // One annotation per (label, sentence range); spans of the same label
  // inside one sentence collapse. The exact span survives in the reason.
  const seen = new Map<string, GoldSentence & { spanTexts: string[] }>()
  for (const s of goldByArticle.get(id) ?? []) {
    const key = `${s.label}@${s.sentenceStart}-${s.sentenceEnd}`
    const entry = seen.get(key)
    if (entry) entry.spanTexts.push(s.spanText)
    else seen.set(key, { ...s, spanTexts: [s.spanText] })
  }
  const spans = [...seen.values()].sort((a, b) => a.sentenceStart - b.sentenceStart)
  const block = {
    annotations: spans.map((s) => ({
      text: s.sentenceText,
      reason: `Gold (${s.label}) — span: ${s.spanTexts.map((t) => JSON.stringify(t.replace(/\s+/g, " ").slice(0, 120))).join(", ")}`,
      code: calloutId(s.label),
      actor: "user" as const,
    })),
  }
  const parsed = AnnotationsBlockSchema.safeParse(block)
  if (!parsed.success) throw new Error(`invalid annotations for ${id}: ${parsed.error.message}`)
  const doc =
    text.trimEnd() +
    "\n\n" +
    formatBlock("json-attributes", attributes) +
    "\n" +
    formatBlock("json-annotations", parsed.data)
  writeFileSync(join(outDir, "corpus", `article${id}.md`), doc)
}

console.log(
  `codebook: ${callouts.length} codes; corpus: ${articles.size} articles; gold spans: ${labelLines.length}`
)
