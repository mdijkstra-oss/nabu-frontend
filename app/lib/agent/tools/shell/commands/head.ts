import { command, ok, err, normalizePath, isGlob, resolveFileContent, hasFile } from "./command"

export const head = command({
  description: "Print first N lines",
  usage: "head [-n count] [file]",
  flags: {
    "-n": { alias: "--lines", description: "number of lines (default 10)", value: true },
  },
  handler: (files) => (paths, _flags, stdin, flagValues) => {
    const count = parseInt(flagValues["-n"] ?? "10", 10) || 10

    const filename = normalizePath(paths[0])
    if (filename && isGlob(filename)) return err("head: globs not supported")
    if (filename && !hasFile(files, filename)) return err(`head: ${filename}: No such file`)

    const content = filename ? (resolveFileContent(files, filename) ?? "") : stdin
    const lines = content.split("\n").slice(0, count)
    return ok(lines.join("\n"))
  },
})
