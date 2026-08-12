import { toSystem, toUser } from "~/lib/agent/client/convert"
import { markCacheBreakpoint, type Message } from "~/lib/agent/tools/apply-deep-analysis/messages"
import { renderNumberedSentences, toModelNumber } from "./payload"
import type { FindInput, MarkInput } from "./types"

const FIND_CTA =
  "Where does this occur in the text above? Report every occurrence as the phrase naming it, the number of the sentence it sits in, and the value it resolves to. Say nothing about how far any of them reaches. Reuse a value from the known list where one fits; create a new one only when nothing fits."

const MARK_CTA =
  "How far does this occurrence reach? Its location is not in doubt. Return the number of the first and the last sentence of the stretch of text it owns."

const NO_KNOWN_VALUES = "No known values yet — infer the value from the text alone."

const knownValuesMessage = (values: string[]): string =>
  values.length === 0 ? NO_KNOWN_VALUES : `Known values: ${[...values].sort().join(", ")}`

const hitLine = ({ quote, hitSentence }: MarkInput): string =>
  `The occurrence is "${quote}", in sentence ${toModelNumber(hitSentence)}.`

export const buildFindMessages = (call: FindInput): Message[] => [
  ...markCacheBreakpoint([toSystem(call.rules)]),
  toSystem(knownValuesMessage(call.knownValues)),
  toSystem(renderNumberedSentences(call.sentences, call.firstSentence)),
  toUser(FIND_CTA),
]

export const buildMarkMessages = (call: MarkInput): Message[] => [
  ...markCacheBreakpoint([toSystem(call.rules)]),
  toSystem(`${renderNumberedSentences(call.sentences, call.windowStart)}\n\n${hitLine(call)}`),
  toUser(MARK_CTA),
]
