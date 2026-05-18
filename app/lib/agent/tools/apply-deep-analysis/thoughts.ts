import { showProgress } from "../../client/store"

const sample = (items: readonly string[]): string => items[Math.floor(Math.random() * items.length)]

export const think = (thoughts: readonly string[]): void => showProgress(sample(thoughts))

export const STARTING = [
  "Working through the material…",
  "Let me work through these sections…",
  "Diving into the content…",
  "Beginning the analysis…",
] as const

export const PICKING_UP = ["Picking up", "Turning to", "Moving on to", "Looking at"] as const

export const READING_FRAMEWORK = [
  "Reading against the framework…",
  "Applying the criteria…",
  "Evaluating against the source definitions…",
  "Holding this up to the framework…",
] as const

export const FINDING = [
  "Checking through another lens…",
  "Scanning for relevant patterns…",
  "Looking for what matches…",
  "Searching for alignments…",
  "Examining from a different angle…",
] as const

export const CONSENSUS = [
  "Forming consensus…",
  "Comparing perspectives…",
  "Triangulating the results…",
  "Seeing where the readings agree…",
] as const

export const REVISITING = [
  "Revisiting what stood out…",
  "Going back over the highlights…",
  "Taking a second look at what emerged…",
  "Circling back to the findings…",
] as const

export const ADJUDICATING = [
  "Reconsidering the borderline cases…",
  "Weighing the uncertain ones…",
  "Deliberating on the edge cases…",
  "Giving the ambiguous ones a harder look…",
] as const

export const WRITING = [
  "Writing into",
  "Committing results to",
  "Recording findings in",
  "Inscribing",
] as const

export const thinkWithName = (thoughts: readonly string[], name: string): void =>
  showProgress(`${sample(thoughts)} ${name}…`)
