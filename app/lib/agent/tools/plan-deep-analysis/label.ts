import type { LabelItem } from "./filter"
import type { LabeledTarget } from "./format"
import { labelSection } from "../scout-map"
import { presentContent } from "../scout/prose"
import { remapRanges } from "~/lib/data-blocks/strip-lines"
import { processPool } from "~/lib/utils/pool"
import { errorMessage } from "~/lib/utils/error"

export const labelAll = async (items: LabelItem[]): Promise<LabeledTarget[]> => {
  const { results, failures } = await processPool(
    items,
    async ({ path, composite, lineMap }) => {
      const presented = presentContent(composite.content)
      const label = await labelSection(presented)
      const rawRanges = composite.segments.map((s) => ({
        startLine: s.startLine,
        endLine: s.endLine,
      }))
      const ranges = remapRanges(lineMap, rawRanges)
      return [{ path, label: label.label, desc: label.desc, ranges } as LabeledTarget]
    },
    () => undefined,
    { concurrency: 10 }
  )

  if (failures.length > 0) {
    const paths = [...new Set(failures.map((f) => (f.item as LabelItem).path))]
    const details = failures.map((f) => errorMessage(f.error)).join("; ")
    throw new Error(
      `labeling failed for ${paths.join(", ")}: ${failures.length} chunk(s): ${details}`
    )
  }

  return results as LabeledTarget[]
}
