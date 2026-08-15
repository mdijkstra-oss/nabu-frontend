import type { DebugAgent } from "./types"
import { regionFinder } from "./region-finder"
import { regionMarker } from "./region-marker"
import { regionPass } from "./region-pass"
import { scoutFilter } from "./scout-filter"
import { semanticFilter } from "./semantic-filter"
import { topicAssigner } from "./topic-assigner"
import { fileHyde } from "./file-hyde"
import { corpusDescriber } from "./corpus-describer"

export const registry: DebugAgent[] = [
  regionFinder,
  regionMarker,
  regionPass,
  scoutFilter,
  semanticFilter,
  topicAssigner,
  fileHyde,
  corpusDescriber,
]
