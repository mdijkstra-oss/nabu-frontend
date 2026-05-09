import { command, ok, err, normalizePath, isGlob, resolveFileContent, hasFile } from "./command"

export const tail = command({
  description: "Print last N lines",
  usage: "tail [-n count] [file]",
  flags: {
    "-n": { alias: "--lines", description: "number of lines (default 10)", value: true },
  },
  handler: (files) => (paths, _flags, stdin, flagValues) => {
    const raw = flagValues["-n"] ?? "10"
    const isFromTop = raw.startsWith("+")
    const count = parseInt(raw, 10) || 10

    const filename = normalizePath(paths[0])
    if (filename && isGlob(filename)) return err("tail: globs not supported")
    if (filename && !hasFile(files, filename)) return err(`tail: ${filename}: No such file`)

    const content = filename ? (resolveFileContent(files, filename) ?? "") : stdin
    const allLines = content.split("\n")
    const lines = isFromTop ? allLines.slice(count - 1) : allLines.slice(-count)
    return ok(lines.join("\n"))
  },
})
