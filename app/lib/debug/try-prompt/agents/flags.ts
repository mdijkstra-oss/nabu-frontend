import { z } from "zod"
import { getKind, REGION_KIND_IDS, type KindDescriptor } from "~/lib/regions/kinds/registry"
import type { FlagMeta } from "./types"

const flagMeta = (placeholder: string, description: string): FlagMeta => ({
  placeholder,
  description,
})

const KIND_LIST = REGION_KIND_IDS.join(", ")

const toKind = (id: string, ctx: z.RefinementCtx): KindDescriptor => {
  const kind = getKind(id)
  if (kind) return kind
  ctx.addIssue({ code: "custom", message: `unknown kind "${id}"; registered kinds: ${KIND_LIST}` })
  return z.NEVER
}

export const kindFlag = z
  .string()
  .transform(toKind)
  .meta(flagMeta("<id>", `a region kind: ${KIND_LIST}`))

export const splitCommaSeparated = (raw: string): string[] =>
  raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

export const commaSeparatedFlag = (description: string) =>
  z.string().transform(splitCommaSeparated).meta(flagMeta("<a,b,…>", description))

export const textFlag = (placeholder: string, description: string) =>
  z.string().min(1).meta(flagMeta(placeholder, description))

export const pathFlag = (description: string) => textFlag("<path>", description)
