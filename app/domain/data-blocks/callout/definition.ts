import { CalloutSchema, type CalloutBlock } from "./schema"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"

export const calloutToDeepSource = (parsed: unknown): string | null => {
  const c = parsed as Partial<CalloutBlock>
  if (!c.id || !c.title || !c.content) return null
  return `<analysis id="${c.id}">\n# ${c.title}\n${c.content}\n</analysis>`
}

export const jsonCallout: BlockTypeConfig = {
  schema: () => CalloutSchema,
  readonly: [],
  immutable: {
    id: 'Field "id" is immutable and cannot be changed',
  },
  constraints: [],
  renderer: "callout",
  singleton: false,
  projected: true,
  tableName: "callouts",
  labelKey: "title",
  multilineFields: ["content"],
  normalizeAsFile: ["content"],
  expandIdRefs: [{ field: "content", prefix: "annotation", replaceWith: "text" }],
  idPaths: [{ path: "id", prefix: "callout" }],
  actorPaths: [{ path: "actor" }],
}
