import { z } from "zod"
import { fnvHash } from "~/lib/utils/hash"
import { BLOCK_COLORS } from "~/ui/theme/colors"
import { ICON_NAMES } from "~/ui/theme/icons"
import { speakerKind } from "~/domain/regions/kinds/speaker/definition"
import { dateKind } from "~/domain/regions/kinds/date/definition"

export const REGION_VALUE_TYPES = ["string", "datetime"] as const

export type RegionValueType = (typeof REGION_VALUE_TYPES)[number]

const colorEnum = z.enum(BLOCK_COLORS as [string, ...string[]])

export const kindDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z]+$/, "id must be a lowercase word"),
  rules: z.string().refine((s) => s.trim().length > 0, "rules must not be blank"),
  icon: z.enum(ICON_NAMES),
  color: colorEnum,
  valueType: z.enum(REGION_VALUE_TYPES),
})

export type KindDescriptor = z.infer<typeof kindDescriptorSchema>

const describeIssue = (id: unknown, issue: z.core.$ZodIssue): string =>
  `region kind ${String(id)}: ${issue.path.join(".") || "<root>"} — ${issue.message}`

const parseDescriptor = (raw: unknown): KindDescriptor => {
  const result = kindDescriptorSchema.safeParse(raw)
  if (result.success) return result.data
  const id = (raw as { id?: unknown })?.id
  throw new Error(result.error.issues.map((issue) => describeIssue(id, issue)).join("; "))
}

const assertDistinct = (descriptors: KindDescriptor[], field: "id" | "color"): void => {
  const seen = new Set<string>()
  for (const d of descriptors) {
    if (seen.has(d[field])) throw new Error(`region kind ${d.id}: duplicate ${field} "${d[field]}"`)
    seen.add(d[field])
  }
}

// Exported so the failure cases can be exercised on hand-built input; the shipped
// table below is the same call with the same rules.
export const parseKindRegistry = (raw: unknown[]): KindDescriptor[] => {
  const descriptors = raw.map(parseDescriptor)
  assertDistinct(descriptors, "id")
  assertDistinct(descriptors, "color")
  return descriptors
}

const shipped = parseKindRegistry([speakerKind, dateKind])

export const regionKinds = (): KindDescriptor[] => shipped

const byId = new Map(shipped.map((k) => [k.id, k]))

export const getKind = (id: string): KindDescriptor | undefined => byId.get(id)

export const rulesHashOf = (kind: KindDescriptor): string => fnvHash(kind.rules)

export const REGION_KIND_IDS = shipped.map((k) => k.id) as [string, ...string[]]
