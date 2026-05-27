import { calloutToProse } from "./callout/toProse"

export type ToProseFn = (block: unknown) => string | null

export const toProseFns: Record<string, ToProseFn> = {
  "json-callout": calloutToProse,
}
