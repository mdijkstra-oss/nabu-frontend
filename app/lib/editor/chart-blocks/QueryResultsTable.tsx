"use client"

import { Copy } from "lucide-react"

interface QueryResultsTableProps {
  rows: Record<string, unknown>[]
  query: string
}

const extractColumns = (rows: Record<string, unknown>[]): string[] =>
  rows.length === 0 ? [] : Object.keys(rows[0])

const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

const copyToClipboard = (text: string) => navigator.clipboard.writeText(text)

export const QueryResultsTable = ({ rows, query }: QueryResultsTableProps) => {
  const columns = extractColumns(rows)

  return (
    <details className="border-t border-solid border-neutral-border overflow-hidden">
      <summary className="px-4 py-2 text-xs text-subtext-color cursor-pointer select-none hover:bg-neutral-50">
        Query results ({rows.length} rows)
      </summary>
      <div className="flex items-start gap-1 px-4 py-2 bg-neutral-50 border-b border-solid border-neutral-border">
        <pre className="flex-1 min-w-0 text-xs text-subtext-color whitespace-pre-wrap break-words font-mono">
          {query}
        </pre>
        <button
          type="button"
          className="shrink-0 p-1 rounded hover:bg-neutral-200 text-subtext-color transition-colors"
          onClick={() => copyToClipboard(query)}
        >
          <Copy size={12} />
        </button>
      </div>
      <div className="overflow-auto max-h-64">
        <table className="w-max text-xs border-collapse">
          <thead>
            <tr className="bg-neutral-50">
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-1.5 text-left font-medium text-subtext-color border-b border-solid border-neutral-border whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-solid border-neutral-border last:border-b-0">
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1 text-default-font whitespace-nowrap max-w-48 truncate"
                  >
                    {formatCellValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
