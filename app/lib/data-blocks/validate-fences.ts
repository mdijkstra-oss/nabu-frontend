export interface FenceError {
  line: number
  message: string
}

const FENCE = "```"
const LINE_SPLIT_RE = /\r\n|\r|\n/

const isFenceLine = (line: string): boolean => line.trimStart().startsWith(FENCE)

const hasStrayFence = (line: string): boolean => line.includes(FENCE) && !isFenceLine(line)

const openerLanguage = (line: string): string =>
  line.trimStart().slice(FENCE.length).trim().split(/\s+/)[0]

export const validateFences = (markdown: string): FenceError[] => {
  const strayErrors: FenceError[] = []
  const languageErrors: FenceError[] = []
  const lines = markdown.split(LINE_SPLIT_RE)
  let fenceCount = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (hasStrayFence(line)) {
      strayErrors.push({
        line: i + 1,
        message: `Code fence \`${FENCE}\` must be at the start of its own line (found inline on line ${i + 1}).`,
      })
      continue
    }
    if (isFenceLine(line)) {
      const isOpener = fenceCount % 2 === 0
      if (isOpener && openerLanguage(line) === "") {
        languageErrors.push({
          line: i + 1,
          message: `Code fence on line ${i + 1} is missing a language tag. Only typed data blocks are allowed (e.g. \`${FENCE}json-callout\`); plain code blocks are not.`,
        })
      }
      fenceCount++
    }
  }

  if (fenceCount % 2 !== 0) {
    return [
      ...strayErrors,
      {
        line: lines.length,
        message: `Unbalanced code fences: found ${fenceCount} \`${FENCE}\` line(s), expected an even number. A fence was opened but never closed (or closed but never opened).`,
      },
    ]
  }

  return [...strayErrors, ...languageErrors]
}
