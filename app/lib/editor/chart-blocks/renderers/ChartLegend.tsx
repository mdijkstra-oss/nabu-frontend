"use client"

import type { ReactElement } from "react"

export interface ChartLegendEntry {
  value?: string | number
  color?: string
  dataKey?: string | number
}

export interface ChartLegendProps {
  payload?: ChartLegendEntry[]
}

export const ChartLegend = ({ payload = [] }: ChartLegendProps): ReactElement => (
  <ul className="nabu-chart-legend">
    {payload.map((entry, index) => (
      <li
        key={entry.dataKey !== undefined ? String(entry.dataKey) : index}
        className="nabu-chart-legend-item"
      >
        <span className="nabu-chart-legend-swatch" style={{ background: entry.color }} />
        {entry.value}
      </li>
    ))}
  </ul>
)
