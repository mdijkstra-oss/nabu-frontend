export const charOffsetToLine = (content: string, offset: number): number => {
  let line = 0
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++
  }
  return line
}

export const getLineContent = (content: string, startLine: number, endLine: number): string => {
  const lines = content.split("\n")
  const clamped = Math.min(endLine, lines.length - 1)
  return lines.slice(startLine, clamped + 1).join("\n")
}
