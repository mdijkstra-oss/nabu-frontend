import { FILTER_VOTERS, type FilterVoter } from "./def"

export type CodingPassthroughStage = "retrieval" | "semantic-filter"

export interface CodingConfig {
  passthrough: ReadonlySet<CodingPassthroughStage>
  coders: readonly ["voter-one"] | readonly ["voter-one", "voter-two"]
  adjudicate: boolean
}

export const DEFAULT_CODING_CONFIG: CodingConfig = {
  passthrough: new Set(),
  coders: FILTER_VOTERS,
  adjudicate: true,
}

export const validateCodingConfig = (config: CodingConfig): string | null => {
  const validStages = new Set<CodingPassthroughStage>(["retrieval", "semantic-filter"])
  const unknown = [...config.passthrough].filter((stage) => !validStages.has(stage))
  if (unknown.length > 0) return `Unknown passthrough stage(s): ${unknown.join(", ")}`

  const coders: readonly FilterVoter[] = config.coders
  if (coders.length === 1 && coders[0] === "voter-one" && !config.adjudicate) return null
  if (
    coders.length === 2 &&
    coders[0] === "voter-one" &&
    coders[1] === "voter-two" &&
    config.adjudicate
  )
    return null
  return "One coder requires adjudicate=false; voter-one plus voter-two requires adjudicate=true"
}
