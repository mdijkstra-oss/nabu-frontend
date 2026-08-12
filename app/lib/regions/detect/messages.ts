import { toSystem } from "~/lib/agent/client/convert"
import type { CallShape } from "~/lib/calls/entry"

const FIND_CTA =
  "Where does this occur in the entries above? Answer every entry by its id — an entry holding nothing gets an empty occurrences list. Report each occurrence as the phrase naming it, the ref of the sentence it sits in, and the value it resolves to. Say nothing about how far any of them reaches. Reuse a value from the known list where one fits; create a new one only when nothing fits."

const MARK_CTA =
  "How far does each occurrence reach? Every occurrence is already located; its position is not in doubt. For each one, return its entry id, its n, and the refs of the first and the last sentence of the stretch of text it owns."

const NO_KNOWN_VALUES = "No known values yet — infer the value from the text alone."

const knownValuesMessage = (values: string[]): string =>
  values.length === 0 ? NO_KNOWN_VALUES : `Known values: ${[...values].sort().join(", ")}`

export const findCallShape = (rules: string, knownValues: string[] | null): CallShape => ({
  stable: [toSystem(rules)],
  volatile: knownValues === null ? undefined : [toSystem(knownValuesMessage(knownValues))],
  callToAction: FIND_CTA,
})

export const markCallShape = (rules: string): CallShape => ({
  stable: [toSystem(rules)],
  callToAction: MARK_CTA,
})
