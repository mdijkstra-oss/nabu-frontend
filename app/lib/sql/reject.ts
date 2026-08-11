const CASE_RE = /\bCASE\b/i

const STRING_FUNCTIONS = [
  "concat",
  "concat_ws",
  "printf",
  "format",
  "format_bytes",
  "lower",
  "upper",
  "initcap",
  "substring",
  "substr",
  "left",
  "right",
  "split_part",
  "replace",
  "regexp_replace",
  "translate",
  "lpad",
  "rpad",
  "ltrim",
  "rtrim",
  "trim",
  "reverse",
  "repeat",
] as const

const STRING_FUNCTION_RE = new RegExp(`\\b(${STRING_FUNCTIONS.join("|")})\\s*\\(`, "gi")

export const rejectCase = (sql: string): string[] => {
  if (!CASE_RE.test(sql)) return []
  return [
    "CASE expressions are not allowed in data queries. Output real columns instead — for colors, join a VALUES list mapping each category to a Radix token and select its column; do not use CASE to rename, group, or colorize.",
  ]
}

const extractStringFunctions = (sql: string): string[] => {
  const found = new Set<string>()
  const re = new RegExp(STRING_FUNCTION_RE.source, STRING_FUNCTION_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(sql)) !== null) {
    found.add(match[1].toLowerCase())
  }
  return [...found]
}

export const rejectStringFormatting = (sql: string): string[] => {
  const found = extractStringFunctions(sql)
  if (found.length === 0) return []
  return [
    `String manipulation functions are not allowed (${found.join(", ")}). Output columns as-is — do not rename, format, or transform them in SQL.`,
  ]
}

export const rejectSqlPatterns = (sql: string): string[] => [
  ...rejectCase(sql),
  ...rejectStringFormatting(sql),
]
