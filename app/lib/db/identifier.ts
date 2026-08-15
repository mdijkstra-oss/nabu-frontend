// The one authority on whether a string can be used as a bare, unquoted DuckDB
// identifier. Doc tables put user- and agent-authored names into DDL text, and
// three separate checks of "is this usable" would drift apart.

export const SQL_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/

// From `SELECT keyword_name FROM duckdb_keywords() WHERE keyword_category =
// 'reserved'` on duckdb-wasm 1.33. Unquoted, each is a syntax error rather than
// a name — `when DATE` does not parse.
const RESERVED_KEYWORDS = [
  "all",
  "analyse",
  "analyze",
  "and",
  "any",
  "array",
  "as",
  "asc",
  "asymmetric",
  "both",
  "case",
  "cast",
  "check",
  "collate",
  "column",
  "constraint",
  "create",
  "default",
  "deferrable",
  "desc",
  "describe",
  "distinct",
  "do",
  "else",
  "end",
  "except",
  "false",
  "fetch",
  "for",
  "foreign",
  "from",
  "group",
  "having",
  "in",
  "initially",
  "intersect",
  "into",
  "lambda",
  "lateral",
  "leading",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "pivot",
  "pivot_longer",
  "pivot_wider",
  "placing",
  "primary",
  "qualify",
  "references",
  "returning",
  "select",
  "show",
  "some",
  "summarize",
  "symmetric",
  "table",
  "then",
  "to",
  "trailing",
  "true",
  "union",
  "unique",
  "unpivot",
  "using",
  "variadic",
  "when",
  "where",
  "window",
  "with",
]

// `constructor` is the only Object.prototype name matching the pattern above.
// A row that omits such a column resolves the lookup to a function off the
// prototype chain, so a non-string reaches code that expects a cell.
const PROTOTYPE_NAMES = ["constructor"]

const UNUSABLE = new Set([...RESERVED_KEYWORDS, ...PROTOTYPE_NAMES])

export const UNUSABLE_IDENTIFIERS: readonly string[] = [...UNUSABLE].sort()

export const isUnusableIdentifier = (name: string): boolean => UNUSABLE.has(name)

export const isUsableIdentifier = (name: string): boolean =>
  SQL_IDENTIFIER_PATTERN.test(name) && !isUnusableIdentifier(name)
