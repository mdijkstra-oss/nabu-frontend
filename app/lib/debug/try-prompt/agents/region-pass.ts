import { z } from "zod"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"
import { runFind } from "~/lib/regions/detect/find"
import { runMark } from "~/lib/regions/detect/mark"
import { regionKinds } from "~/lib/regions/kinds/registry"
import { planRegionFilePass, seedVocabulary } from "~/lib/regions/sync"
import { defineAgent } from "./types"
import { kindFlag } from "./flags"
import { onlyFileOf } from "./document"

const extras = z.object({
  kind: kindFlag.optional(),
})

export const regionPass = defineAgent({
  name: "region-pass",
  summary:
    "find, mark, reconcile and merge, as the app does for one file; every kind unless --kind",
  input: "file",
  extras,
  constructedLabel: "regions block",
  run: async ({ files, extras: { kind } }) => {
    const { file, raw } = onlyFileOf(files)
    let captured: RegionsBlock | undefined
    const plan = planRegionFilePass(
      file,
      raw,
      kind ? [kind] : regionKinds(),
      (each) => seedVocabulary(files, each.id),
      {
        getFile: (path) => files[path],
        detect: { find: runFind, mark: runMark },
        writeRegions: (_, next) => {
          captured = next
          return "written"
        },
      }
    )
    await plan.run()
    return captured
  },
})
