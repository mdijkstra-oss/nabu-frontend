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

const codeExists = (codeId: string, codes: { id: string }[]): boolean =>
  codes.some((c) => c.id === codeId)

const formatAvailableCodes = (codes: { id: string; name: string }[]): Record<string, string> =>
  Object.fromEntries(codes.map((c) => [c.name, c.id]))

const BaseAnnotationSchema = z.object({
  text: z.string().describe("Exact text from the document"),
  reason: z.string().describe("Why this text was annotated"),
  color: emptyToUndefined(radixColor).describe("Color for the annotation (if no code)"),
  code: emptyToUndefined(z.string()).describe("Code ID from codebook (if no color)"),
  id: z.string().optional(),
  actor: z.enum(["ai", "user"]).optional(),
  vote: z
    .object({
      find: z.object({ found: z.number().int(), missed: z.number().int() }),
      review: z.string().optional(),
    })
    .optional(),
})

export const annotationSchema = (ctx?: ValidationContext) => {
  const base = BaseAnnotationSchema.refine(
    hasColorOrCode,
    "Either color or code must be set, not both"
  )
  if (!ctx) return base
  return base.superRefine((a, ctx2) => {
    if (a.code && !codeExists(a.code, ctx.availableCodes)) {
      ctx2.addIssue({
        code: "custom",
        message: `Code "${a.code}" not found`,
        params: { hint: formatAvailableCodes(ctx.availableCodes) },
      })
    }
  })
}

export const AnnotationSchema = annotationSchema()
export type Annotation = z.infer<typeof AnnotationSchema>

const tagIdExists = (id: string, available: { id: string; label: string }[]): boolean =>
  available.some((t) => t.id === id)

const formatAvailableTags = (tags: { id: string; label: string }[]): Record<string, string> =>
  Object.fromEntries(tags.map((t) => [t.label, t.id]))

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

export const documentMetaSchema = (ctx?: ValidationContext) => {
  if (!ctx || ctx.availableTags.length === 0) return BaseDocumentMeta
  return BaseDocumentMeta.superRefine((meta, ctx2) => {
    if (!meta.tags) return
    const bad = meta.tags.filter((t) => !tagIdExists(t, ctx.availableTags))
    for (const tag of bad) {
      ctx2.addIssue({
        code: "custom",
        path: ["tags"],
        message: `Tag "${tag}" is not defined in settings`,
        params: { hint: formatAvailableTags(ctx.availableTags) },
      })
    }
  })
}

export const DocumentMeta = documentMetaSchema()
export type DocumentMeta = z.infer<typeof DocumentMeta>

export const patchAnnotationRequired = (schema: Record<string, unknown>): Record<string, unknown> =>
  removeFromRequired(schema, ["properties", "annotations", "items"], ["color", "code"])
