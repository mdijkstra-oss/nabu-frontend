import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import mri from "mri"
import {
  analyzeDocument,
  DEFAULT_SETTINGS,
  renderCorpusReport,
  renderDocumentDump,
  type DocumentAnalysis,
  type ReportSettings,
} from "~/lib/debug/chunking-report"

const USAGE = [
  "Usage: npx vite-node scripts/debug-chunking.ts -- <file-or-directory> [options]",
  "",
  "  A file prints the annotated dump: every sentence numbered, a rule at each unit",
  "  boundary, and a header saying why that unit closed. A directory prints the",
  "  distribution: sentence lengths, unit sizes, a mask sweep and a stability probe.",
  "",
  `  --mask <bits>      how rarely a gap becomes a boundary, 1 in 2^bits (default ${DEFAULT_SETTINGS.maskBits})`,
  `  --window <chars>   how much text before a gap is hashed (default ${DEFAULT_SETTINGS.window})`,
  `  --floor <chars>    below this a gap cannot become a boundary (default ${DEFAULT_SETTINGS.floor})`,
  `  --ceiling <chars>  above this a boundary is forced (default ${DEFAULT_SETTINGS.ceiling})`,
].join("\n")

const flags = mri(process.argv.slice(2), {
  default: {
    mask: DEFAULT_SETTINGS.maskBits,
    window: DEFAULT_SETTINGS.window,
    floor: DEFAULT_SETTINGS.floor,
    ceiling: DEFAULT_SETTINGS.ceiling,
  },
})

const settings: ReportSettings = {
  maskBits: Number(flags.mask),
  window: Number(flags.window),
  floor: Number(flags.floor),
  ceiling: Number(flags.ceiling),
}

const invalidSetting = (): string | null => {
  for (const [name, value] of Object.entries(settings)) {
    if (!Number.isFinite(value) || value < 0) return `${name} must be a non-negative number`
  }
  return settings.floor > settings.ceiling ? "floor must not exceed ceiling" : null
}

const analyzeFile = (path: string): DocumentAnalysis =>
  analyzeDocument(basename(path), readFileSync(path, "utf-8"), settings)

const markdownFilesIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(dir, name))

const inputPath = flags._[0]
if (!inputPath) {
  console.error(USAGE)
  process.exit(1)
}

const invalid = invalidSetting()
if (invalid) {
  console.error(`${invalid}\n\n${USAGE}`)
  process.exit(1)
}

if (!existsSync(inputPath)) {
  console.error(`No such file or directory: ${inputPath}`)
  process.exit(1)
}

if (!statSync(inputPath).isDirectory()) {
  console.log(renderDocumentDump(analyzeFile(inputPath), settings))
} else {
  const paths = markdownFilesIn(inputPath)
  if (paths.length === 0) {
    console.log(`No markdown files in ${inputPath}`)
  } else {
    console.log(renderCorpusReport(paths.map(analyzeFile), settings))
  }
}
