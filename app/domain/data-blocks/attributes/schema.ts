import type { ComponentType } from "react"
import { z } from "zod"
import { Highlighter } from "lucide-react"
import { BLOCK_COLORS } from "~/ui/theme/colors"
import { emptyToUndefined } from "~/lib/data-blocks/field-validate"
import type { ValidationContext } from "~/lib/data-blocks/definition"
import { removeFromRequired } from "~/lib/data-blocks/json-schema"

export const annotationIcon: ComponentType<{ className?: string }> = Highlighter

export const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
export const radixColor = z.enum(BLOCK_COLORS as [string, ...string[]])

const hasColorOrCode = (a: { color?: unknown; code?: unknown }) =>
  (a.color !== undefined) !== (a.code !== undefined)

const BaseAnnotationSchema = z.object({
  text: z.string().describe("Exact text from the document"),
  reason: z.string().describe("Why this text was annotated"),
  color: emptyToUndefined(radixColor).describe("Color for the annotation (if no code)"),
  code: emptyToUndefined(z.string()).describe("Code ID from codebook (if no color)"),
  id: z.string().optional(),
  actor: z.enum(["ai", "user"]).optional(),
  locked: z.boolean().optional(),
  vote: z
    .object({
      find: z.object({ found: z.number().int(), missed: z.number().int() }),
      review: z.string().optional(),
    })
    .optional(),
})

// Cross-file id existence (code/tag → definition) is owned by the pending-refs system in
// ~/lib/files/pending-refs: unknown ids get wrapped as #[id] markers and resolve when the
// defining file arrives (including later, via multiplayer). Schema stays focused on shape;
// boot-time audit logs lingering orphans (see auditPendingRefsAtBoot in lib/files/store.ts).
export const annotationSchema = (_ctx?: ValidationContext) =>
  BaseAnnotationSchema.refine(hasColorOrCode, "Either color or code must be set, not both")

export const AnnotationSchema = annotationSchema()
export type Annotation = z.infer<typeof AnnotationSchema>

const BaseDocumentMeta = z.object({
  tags: z.array(slug).optional().describe("Tag IDs from settings"),
  date: z.iso.date().optional().describe("Document date, YYYY-MM-DD (ISO 8601)"),
  type: z.string().optional().describe("Auto-classified document format"),
  source: z.string().optional().describe("Auto-classified document source"),
  subject: z.string().optional().describe("Auto-classified topic, 3-5 words"),
  hash: z
    .string()
    .optional()
    .describe("Content hash used to skip re-classification when unchanged"),
})

export const documentMetaSchema = (_ctx?: ValidationContext) => BaseDocumentMeta

export const DocumentMeta = documentMetaSchema()
export type DocumentMeta = z.infer<typeof DocumentMeta>

export const patchAnnotationRequired = (schema: Record<string, unknown>): Record<string, unknown> =>
  removeFromRequired(schema, ["properties", "annotations", "items"], ["color", "code"])
