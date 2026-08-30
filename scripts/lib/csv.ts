// Minimal RFC 4180 parser — the converter inputs are plain CSVs and the repo
// carries no CSV dependency.
export const parseCsv = (raw: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && raw[i + 1] === "\n") i++
      row.push(field)
      field = ""
      rows.push(row)
      row = []
    } else field += ch
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""))
}

export const csvRecords = (raw: string): Record<string, string>[] => {
  const [header, ...rows] = parseCsv(raw)
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])))
}
