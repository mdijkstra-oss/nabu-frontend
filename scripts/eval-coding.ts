import { parseCodingEvalArgs, runCodingEval } from "~/lib/debug/coding-eval"

try {
  const count = await runCodingEval(parseCodingEvalArgs(process.argv.slice(2)))
  console.log(`Wrote ${count} annotation(s).`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
