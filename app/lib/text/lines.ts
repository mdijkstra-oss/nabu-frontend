export const charOffsetToLine = (content: string, offset: number): number => {
  let line = 0
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++
  }
  return line
}

export const lineToCharOffset = (content: string, line: number): number => {
  let offset = 0
  for (let l = 0; l < line; l++) {
    const next = content.indexOf("\n", offset)
    if (next === -1) return content.length
    offset = next + 1
  }
  return offset
}

export const lineEndCharOffset = (content: string, line: number): number => {
  const start = lineToCharOffset(content, line)
  const next = content.indexOf("\n", start)
  return next === -1 ? content.length : next
}

export const getLineContent = (content: string, startLine: number, endLine: number): string => {
  const lines = content.split("\n")
  const clamped = Math.min(endLine, lines.length - 1)
  return lines.slice(startLine, clamped + 1).join("\n")
}
