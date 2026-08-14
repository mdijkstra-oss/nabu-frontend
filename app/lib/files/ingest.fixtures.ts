export const EPOCH = 1700000000000
export const ISO = new Date(EPOCH).toISOString()

// Beyond Date's ±8.64e15 range: JSON-valid, matches the migration's old-shape
// schema, and makes toISOString() throw.
export const UNDATEABLE_EPOCH = 1e16

export const settingsWith = (createdAt: number | string): string =>
  [
    "# Settings",
    "",
    "```json-settings",
    JSON.stringify({ searches: [{ query: "alpha", createdAt }] }, null, 2),
    "```",
    "",
  ].join("\n")

export const CORRUPT = ["# Broken", "", "```json-settings", "{ not json", "```", ""].join("\n")
