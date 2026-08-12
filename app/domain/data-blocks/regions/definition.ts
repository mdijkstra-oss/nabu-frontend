import { regionsBlockSchema, type RegionsBlock } from "./schema"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"

// Derived output, written only by the region sync (lib/regions/sync.ts). Absent from
// BLOCK_TOOL_LANGUAGES, so the agent has no verb that reaches it — regions the agent
// could write would be provenance a researcher reads as detection.
export const jsonRegions: BlockTypeConfig<RegionsBlock> = {
  schema: regionsBlockSchema,
  readonly: ["regions", "scanned"],
  immutable: {},
  constraints: [],
  renderer: "hidden",
  singleton: true,
  projected: true,
  rowPath: "regions",
}
