import mri from "mri"
import { compareCodingFiles } from "~/lib/debug/coding-eval"

try {
  const args = mri(process.argv.slice(2), { string: ["actual", "gold"] })
  if (typeof args.actual !== "string" || typeof args.gold !== "string")
    throw new Error("Usage: npm run eval:coding:compare -- --actual <actual.md> --gold <gold.md>")
  const result = compareCodingFiles(args.actual, args.gold)
  console.log(
    `Actual annotations: ${result.actual}\nGold annotations: ${result.gold}\nSame-code source-span overlaps: ${result.overlapping}`
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
