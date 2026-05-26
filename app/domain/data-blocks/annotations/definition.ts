import { annotationsBlockSchema, type AnnotationsBlock } from "./schema"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"
import { patchAnnotationRequired } from "~/domain/data-blocks/attributes/schema"
import { normalizeAnnotations } from "./normalize"

export const jsonAnnotations: BlockTypeConfig<AnnotationsBlock> = {
  schema: annotationsBlockSchema,
  readonly: [],
  immutable: {},
  constraints: [
    "each entry requires either 'color' or 'code', not both",
    "text: must be text from the document prose (fuzzy-matched automatically)",
  ],
  renderer: "hidden",
  singleton: true,
  projected: true,
  rowPath: "annotations",
  idPaths: [{ path: "annotations.*.id", prefix: "annotation" }],
  actorPaths: [{ path: "annotations.*.actor" }],
  fuzzyFields: ["annotations.*.text"],
  patchSchema: patchAnnotationRequired,
  normalize: normalizeAnnotations,
}
