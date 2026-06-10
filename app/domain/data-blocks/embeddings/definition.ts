import { embeddingEntrySchema, type EmbeddingEntry } from "./schema"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"

// Companion file blocks — programmatic, written by embeddings sync (lib/embeddings/sync.ts).
// Registered so server-sync replay through validateMarkdownBlocks doesn't warn on unknown
// language. Not in BLOCK_TOOL_LANGUAGES (no agent tools). Projection lives separately in
// domain/db/projections.ts (embeddingsProjection), so `projected` stays unset here.
export const jsonEmbeddings: BlockTypeConfig<EmbeddingEntry> = {
  schema: embeddingEntrySchema,
  readonly: [],
  immutable: {},
  constraints: [],
  renderer: "hidden",
  singleton: false,
}
