import type { TagDefinition } from "../schema"

export const HIDDEN_TAG_ID = "__hidden"

export const HIDDEN_TAG: TagDefinition = {
  id: HIDDEN_TAG_ID,
  label: "hidden",
  color: "slate",
  icon: "eye",
}
