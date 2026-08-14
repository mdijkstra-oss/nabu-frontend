// JSON keys are camelCase; the database speaks snake_case. Every column and
// child-table name derived from a JSON key passes through here, so the DDL side
// (ddl.ts) and the row-extraction side (extract.ts) can never drift apart.
export const toSnakeCase = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
