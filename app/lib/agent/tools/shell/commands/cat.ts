import { command, ok, err, normalizePath, isGlob, resolveFileContent, hasFile } from "./command"

export const cat = command({
  description: "Print file contents",
  usage: "cat [-n] [-o offset] [-l limit] <file>",
  flags: {
    "-n": { alias: "--number", description: "number output lines" },
    "-o": { alias: "--offset", description: "start at line (default 1)", value: true },
    "-l": { alias: "--lines", description: "max lines to show", value: true },
  },
  handler: (files) => (paths, flags, stdin, flagValues) => {
    const offset = parseInt(flagValues["-o"] ?? "1", 10) || 1
    const limit = flagValues["-l"] ? parseInt(flagValues["-l"], 10) : null

    const filename = normalizePath(paths[0])
    if (filename && isGlob(filename)) {
      return err(`cat: globs not supported, use a specific file path`)
    }
    if (filename && !hasFile(files, filename)) {
      return err(`cat: ${filename}: No such file`)
    }

    const content = filename ? (resolveFileContent(files, filename) ?? "") : stdin

    let lines = content.split("\n")
    lines = lines.slice(offset - 1)
    if (limit !== null) lines = lines.slice(0, limit)

    if (flags.has("-n")) {
      return ok(lines.map((line, i) => `${String(offset + i).padStart(6)}\t${line}`).join("\n"))
    }

    return ok(lines.join("\n"))
  },
})
