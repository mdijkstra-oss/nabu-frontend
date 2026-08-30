/**
 * Converts AnnoMI (Wu et al., "Creation, Analysis and Evaluation of AnnoMI, a
 * Dataset of Expert-Annotated Counselling Dialogues", Future Internet 2023,
 * https://www.mdpi.com/1999-5903/15/3/110; data at
 * https://github.com/uccollab/AnnoMI) into a Nabu benchmark project:
 *
 *   <out>/codebook.md               one json-callout code per gold label (10)
 *   <out>/corpus/transcript-<id>.md dialogue turns + json-attributes
 *
 * Label definitions are embedded verbatim from Section 4 of the paper — the
 * scheme the expert annotators worked from — with the paper's own examples
 * (Tables 5–8). The gold unit is the utterance: each coded utterance is one
 * annotation covering its full "Therapist:"/"Client:" paragraph.
 *
 * Codes mark presence of a phenomenon, so the scheme's absence categories
 * carry no code: therapist "other" (no question/input/reflection) and client
 * "neutral" talk (no preference for or against change) are simply
 * unannotated utterances.
 *
 * Reads AnnoMI-full.csv: unlike the simplified version it carries the
 * question/input/reflection existence flags and subtypes, so an utterance
 * holding e.g. a reflection followed by a question yields both codes, not
 * just the main behaviour. Most utterances have one expert annotator; 428
 * have ten, resolved here by strict majority on existence and plurality on
 * subtype/talk type (unbroken ties are dropped and counted).
 *
 * Usage: npx tsx scripts/annomi-to-nabu.ts <annomi-dir> <output-dir>
 *   where <annomi-dir> holds AnnoMI-full.csv.
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { CalloutSchema, type CalloutBlock } from "~/domain/data-blocks/callout/schema"
import { BLOCK_COLORS } from "~/ui/theme/colors"
import { csvRecords } from "./lib/csv"

interface Code {
  title: string
  color: string
  definition: string
}

const QUESTION =
  "Therapists use asking to develop an understanding of the client and their problems; any question is either open or closed, in accordance with mainstream MI coding conventions."
const INPUT =
  "The primary manner of communicating knowledge to the client is informing. Input covers a wide range of conveyed knowledge, in four subtypes: providing information, giving advice, presenting options, and setting goals (negotiation). When an utterance contains more than one type of input, the main type is labeled."
const REFLECTION =
  "Reflection is an essential means of listening: the therapist shows that they are listening to and understanding the client, which is effective in helping people to change."

const CODES: Record<string, Code> = {
  "question-open": {
    title: "Open question",
    color: "blue",
    definition: `${QUESTION}\n\nAn open question allows a wide range of possible answers and may seek information, invite the client’s perspective, or encourage self-exploration.\n\nEx.: "So what is a typical week for you as far as your alcohol use is concerned?" (seek information); "Okay. So how do you feel about being here today?" (invite the client’s perspective); "So, when you think about what you like and don’t like about your drinking, where do you wanna go from here?" (encourage self-exploration).`,
  },
  "question-closed": {
    title: "Closed question",
    color: "indigo",
    definition: `${QUESTION}\n\nA closed question implies a short answer such as Yes/No, a specific fact, a number, etc.\n\nEx.: "Do you have children in your house?" (Yes/No); "How much does it actually cost you a week?" (number); "Okay. What kind of alcohol do you drink at parties?" (specific fact).`,
  },
  "input-information": {
    title: "Input — information",
    color: "amber",
    definition: `${INPUT}\n\nThis code: providing information.\n\nEx.: "You’re not alone in feeling that way. Binge drinking can feel normal to some people."; "So that’s a hormone that allows you to utilise sugar in your body."`,
  },
  "input-advice": {
    title: "Input — advice",
    color: "orange",
    definition: `${INPUT}\n\nThis code: giving advice.\n\nEx.: "I want you to be healthy. And I don’t want to see you coming back in here for something else. So I’m really gonna recommend that you try to cut down to that amount."; "That’s why I recommend that all my adolescent patients not drink at all."`,
  },
  "input-options": {
    title: "Input — options",
    color: "gold",
    definition: `${INPUT}\n\nThis code: presenting options.\n\nEx.: "So, what have you looked into about, um, you know, advocacy in that area or expungement or anything like that?"; "Okay. So, exploring some yoga classes. Is doing yoga in your living room appealing to you at all?"`,
  },
  "input-negotiation": {
    title: "Input — negotiation/goal setting",
    color: "bronze",
    definition: `${INPUT}\n\nThis code: setting goals (negotiation).\n\nEx.: "So for you being in your class, when that bell rings, then you know, this is the goal."; "Do you think you could go two months without drinking?"`,
  },
  "reflection-simple": {
    title: "Simple reflection",
    color: "green",
    definition: `${REFLECTION}\n\nA simple reflection shows an understanding of the client’s words but contains little additional meaning — for example, by repeating the client’s statement. It identifies the client’s emotion or situation without going beyond the overt content of the client’s statement.\n\nEx.: to a client stressed as a single mom with a full-time job who started smoking again: "Things are very stressful for you right now."`,
  },
  "reflection-complex": {
    title: "Complex reflection",
    color: "jade",
    definition: `${REFLECTION}\n\nA complex reflection conveys a deeper level of understanding of the client’s point of view and adds substantial meaning to the client’s statement, using techniques such as metaphors and exaggeration — "continuing the paragraph" by interpreting the client’s words and anticipating what they might reasonably say next.\n\nEx.: to the same client: "You have a lot of things going on and smoking’s kind of a way to relax and de-stress."`,
  },
  "client-change": {
    title: "Change talk",
    color: "grass",
    definition: `Clients usually feel ambivalent about adopting positive behaviour change; the desirable outcome of MI is for the client to pick up pro-change arguments and talk themselves into changing. Change talk favours change.\n\nEx.: "Yeah, I just want to do what’s right."; "Well, that was fine until I came here, um, but now that I know about the health risk, um, I have something I gotta think about."`,
  },
  "client-sustain": {
    title: "Sustain talk",
    color: "ruby",
    definition: `Sustain talk conveys resistance to behaviour change and favours the status quo.\n\nEx.: "Um, I mean, the 10 drinks seems like not a lot for me and my tolerance."; "Yeah, whatever. I know you got to do your job, but I don’t care."`,
  },
}

// Entity ids are prefix + [0-9][a-z0-9]{7}; derive them from the code key so
// a scoring run can recompute the id-to-label mapping instead of parsing it.
const calloutId = (label: string): string => {
  const hex = createHash("sha256").update(`annomi:${label}`).digest("hex")
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
  throw new Error("usage: npx tsx scripts/annomi-to-nabu.ts <annomi-dir> <output-dir>")

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
  "# AnnoMI motivational interviewing codes",
  "",
  "Codebook of the AnnoMI gold labels. Definitions verbatim from Wu et al. (2023), Section 4 — the scheme the expert annotators worked from — with the paper’s examples (Tables 5–8). Therapist utterances containing no question, input, or reflection (“other”) and client talk with no preference for or against change (“neutral”) carry no code.",
  "",
  ...callouts.map((c) => formatBlock("json-callout", c)),
].join("\n")
writeFileSync(join(outDir, "codebook.md"), codebook)

const records = csvRecords(readFileSync(join(dataDir, "AnnoMI-full.csv"), "utf-8"))

interface Utterance {
  transcript: string
  order: number
  interlocutor: string
  text: string
  quality: string
  topic: string
  title: string
  rows: Record<string, string>[]
}

const transcripts = new Map<string, Map<number, Utterance>>()
for (const r of records) {
  let byUtterance = transcripts.get(r.transcript_id)
  if (!byUtterance) {
    byUtterance = new Map()
    transcripts.set(r.transcript_id, byUtterance)
  }
  const order = Number(r.utterance_id)
  let u = byUtterance.get(order)
  if (!u) {
    u = {
      transcript: r.transcript_id,
      order,
      interlocutor: r.interlocutor,
      text: r.utterance_text,
      quality: r.mi_quality,
      topic: r.topic,
      title: r.video_title,
      rows: [],
    }
    byUtterance.set(order, u)
  }
  u.rows.push(r)
}

const plurality = (votes: string[]): string | null => {
  const counts = new Map<string, number>()
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null
  return ranked[0][0]
}

interface GoldLabel {
  code: string
  label: string
  votes: number
  total: number
}

const BEHAVIOURS = [
  { exists: "question_exists", subtype: "question_subtype", prefix: "question", label: "question" },
  {
    exists: "reflection_exists",
    subtype: "reflection_subtype",
    prefix: "reflection",
    label: "reflection",
  },
  {
    exists: "therapist_input_exists",
    subtype: "therapist_input_subtype",
    prefix: "input",
    label: "input",
  },
]

let ties = 0
const goldFor = (u: Utterance): GoldLabel[] => {
  const total = u.rows.length
  const gold: GoldLabel[] = []
  if (u.interlocutor === "therapist") {
    for (const b of BEHAVIOURS) {
      const present = u.rows.filter((r) => r[b.exists] === "True")
      if (present.length * 2 <= total) continue
      const subtype = plurality(present.map((r) => r[b.subtype]))
      if (!subtype) {
        ties++
        continue
      }
      const code = `${b.prefix}-${subtype}`
      if (!(code in CODES)) throw new Error(`unknown gold label ${code}`)
      gold.push({ code, label: `${subtype} ${b.label}`, votes: present.length, total })
    }
  } else {
    const talk = plurality(u.rows.map((r) => r.client_talk_type))
    if (talk === null) ties++
    else if (talk === "change" || talk === "sustain") {
      const votes = u.rows.filter((r) => r.client_talk_type === talk).length
      gold.push({ code: `client-${talk}`, label: `${talk} talk`, votes, total })
    } else if (talk !== "neutral") throw new Error(`unknown client talk type ${talk}`)
  }
  return gold
}

let annotationCount = 0
for (const [id, byUtterance] of transcripts) {
  const utterances = [...byUtterance.values()].sort((a, b) => a.order - b.order)
  const speaker = (u: Utterance): string =>
    u.interlocutor === "therapist" ? "Therapist" : "Client"
  const paragraphs = utterances.map((u) => `${speaker(u)}: ${u.text.trim()}`)
  const doc = paragraphs.join("\n\n")

  const annotations: { text: string; reason: string; code: string; actor: "user" }[] = []
  utterances.forEach((u, i) => {
    for (const g of goldFor(u)) {
      annotations.push({
        text: paragraphs[i],
        reason: `Gold (${g.label})` + (g.total > 1 ? ` — ${g.votes}/${g.total} annotators` : ""),
        code: calloutId(g.code),
        actor: "user",
      })
    }
  })
  annotationCount += annotations.length

  const first = utterances[0]
  const attributes = {
    type: "counselling-transcript",
    source: "AnnoMI (Wu et al. 2023)",
    subject: `${first.topic} — ${first.quality}-quality MI`.slice(0, 80),
  }
  const parsed = AnnotationsBlockSchema.safeParse({ annotations })
  if (!parsed.success)
    throw new Error(`invalid annotations for transcript ${id}: ${parsed.error.message}`)
  const out =
    doc.trimEnd() +
    "\n\n" +
    formatBlock("json-attributes", attributes) +
    "\n" +
    formatBlock("json-annotations", parsed.data)
  writeFileSync(join(outDir, "corpus", `transcript-${id.padStart(3, "0")}.md`), out)
}

console.log(
  `codebook: ${callouts.length} codes; corpus: ${transcripts.size} transcripts; annotations: ${annotationCount} (${ties} unresolved annotator ties dropped)`
)
