import { uxSchema } from "./schema"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"
import type { Ux } from "./schema"

export const jsonUx: BlockTypeConfig<Ux> = {
  schema: uxSchema,
  readonly: [],
  immutable: {},
  constraints: [],
  renderer: "hidden",
  singleton: true,
  allowedFiles: ["settings.hidden.md"],
}
