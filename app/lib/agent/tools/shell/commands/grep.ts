import {
  command,
  ok,
  noMatch,
  err,
  normalizePath,
  isGlob,
  resolveFiles,
  resolveFileContent,
} from "./command"

interface ContextMatch {
  lineNum: number
  line: string
  isMatch: boolean
}

const grepWithContext = (
  lines: string[],
  re: RegExp,
  before: number,
  after: number
): ContextMatch[] => {
  const matchIndices = new Set<number>()
  const contextIndices = new Set<number>()

  lines.forEach((line, i) => {
    if (re.test(line)) {
      matchIndices.add(i)
      for (let j = Math.max(0, i - before); j <= Math.min(lines.length - 1, i + after); j++) {
        contextIndices.add(j)
      }
    }
  })

  return Array.from(contextIndices)
    .sort((a, b) => a - b)
    .map((i) => ({ lineNum: i + 1, line: lines[i], isMatch: matchIndices.has(i) }))
}

const formatMatch = (
  filePath: string | null,
  m: ContextMatch,
  showLineNumbers: boolean
): string => {
  const sep = m.isMatch ? ":" : "-"
  if (filePath && showLineNumbers) return `${filePath}${sep}${m.lineNum}${sep}${m.line}`
  if (filePath) return `${filePath}${sep}${m.line}`
  if (showLineNumbers) return `${m.lineNum}${sep}${m.line}`
  return m.line
}

export const grep = command({
  description: "Search for patterns in files",
  usage: "grep [-n] [-i] [-o] [-w] [-l] [-c] [-v] [-B N] [-A N] [-C N] <pattern> [file]",
  flags: {
    "-n": { alias: "--line-number", description: "prefix with line numbers" },
    "-i": { alias: "--ignore-case", description: "case insensitive matching" },
    "-o": { alias: "--only-matching", description: "only print matching part" },
    "-w": { alias: "--word-regexp", description: "match whole words only" },
    "-l": { alias: "--files-with-matches", description: "list only filenames with matches" },
    "-c": { alias: "--count", description: "count matches per file" },
    "-v": { alias: "--invert-match", description: "invert match (non-matching lines)" },
    "-B": { alias: "--before-context", description: "lines of context before match", value: true },
    "-A": { alias: "--after-context", description: "lines of context after match", value: true },
    "-C": { alias: "--context", description: "lines of context before and after", value: true },
    "-E": { alias: "--extended-regexp", description: "ignored (always extended)" },
    "-R": { alias: "--recursive", description: "ignored (flat filesystem)" },
    "-r": { description: "ignored (flat filesystem)" },
    "-I": { alias: "--binary-files=without-match", description: "ignored (text-only filesystem)" },
    "-m": { alias: "--max-count", description: "max matches per file", value: true },
    "-S": { alias: "--smart-case", description: "case-insensitive if pattern is all lowercase" },
    // rg alias compatibility
    "--count-matches": { description: "alias for -c (rg compatibility)" },
  },
  handler: (files) => (args, flags, stdin, flagValues) => {
    const [rawPattern, rawFilename] = args
    const filename = rawFilename === "." ? null : normalizePath(rawFilename)
    if (!rawPattern) return err("grep: missing pattern")

    const pattern = flags.has("-w") ? `\\b${rawPattern}\\b` : rawPattern
    const smartCase = flags.has("-S") && !/[A-Z]/.test(rawPattern)
    const ignoreCase = flags.has("-i") || smartCase
    const re = new RegExp(pattern, ignoreCase ? "gi" : "g")
    const reTest = new RegExp(pattern, ignoreCase ? "i" : "")
    const context = parseInt(flagValues["-C"] ?? "0", 10)
    const before = parseInt(flagValues["-B"] ?? "0", 10) || context
    const after = parseInt(flagValues["-A"] ?? "0", 10) || context
    const maxMatches = parseInt(flagValues["-m"] ?? "0", 10)
    const showLineNumbers = flags.has("-n") || before > 0 || after > 0
    const listOnly = flags.has("-l")
    const countOnly = flags.has("-c")
    const countMatches = flags.has("-count-matches") // rg compat: count all matches not lines
    const onlyMatching = flags.has("-o")
    const invert = flags.has("-v")
    const results: string[] = []
    const fileCounts = new Map<string, number>()
    const filesWithMatches = new Set<string>()

    const searchFile = (filePath: string | null, content: string) => {
      const lines = content.split("\n")
      let lineMatchCount = 0
      let totalMatchCount = 0
      const atLimit = () => maxMatches > 0 && lineMatchCount >= maxMatches

      if (before > 0 || after > 0) {
        const matches = grepWithContext(lines, reTest, before, after)
        const filtered = invert ? matches.filter((m) => !m.isMatch) : matches
        for (const m of filtered) {
          if (m.isMatch !== invert) {
            lineMatchCount++
            totalMatchCount += (m.line.match(re) || []).length
            if (atLimit()) break
          }
          if (!listOnly && !countOnly && !countMatches && !atLimit()) {
            results.push(formatMatch(filePath, m, showLineNumbers))
          }
        }
      } else {
        for (let i = 0; i < lines.length && !atLimit(); i++) {
          const line = lines[i]
          const hasMatch = reTest.test(line)
          const include = invert ? !hasMatch : hasMatch
          if (include) {
            lineMatchCount++
            totalMatchCount += (line.match(re) || []).length
            if (!listOnly && !countOnly && !countMatches) {
              if (onlyMatching && !invert) {
                const allMatches = line.match(re) || []
                const prefix = filePath ? `${filePath}:` : ""
                allMatches.forEach((m) => results.push(prefix + m))
              } else {
                results.push(
                  formatMatch(filePath, { lineNum: i + 1, line, isMatch: true }, showLineNumbers)
                )
              }
            }
          }
        }
      }

      if (lineMatchCount > 0 && filePath) {
        filesWithMatches.add(filePath)
        fileCounts.set(filePath, countMatches ? totalMatchCount : lineMatchCount)
      }
    }

    if (!filename && stdin) {
      searchFile(null, stdin)
      if (results.length === 0) return noMatch()
      if (countOnly || countMatches) return ok(String(fileCounts.get("stdin") ?? results.length))
      return ok(results.join("\n"))
    }

    if (filename) {
      const resolved = resolveFiles(files, filename)
      if (resolved.length === 0 && !isGlob(filename)) {
        const generated = resolveFileContent(files, filename)
        if (generated !== undefined) {
          searchFile(filename, generated)
        } else {
          return err(`grep: ${filename}: No such file`)
        }
      }
      for (const filePath of resolved) {
        const content = files.get(filePath)
        if (content === undefined) continue
        searchFile(filePath, content)
      }
    } else {
      for (const [filePath, content] of files) {
        searchFile(filePath, content)
      }
    }

    if (filesWithMatches.size === 0) return noMatch()
    if (listOnly) return ok([...filesWithMatches].join("\n"))
    if (countOnly || countMatches)
      return ok([...fileCounts].map(([f, c]) => `${f}:${c}`).join("\n"))
    return ok(results.join("\n"))
  },
})
