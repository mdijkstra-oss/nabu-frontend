"use client"

import type { ReactElement } from "react"

export interface ChartLegendEntry {
  value?: string | number
  color?: string
}

export interface ChartLegendProps {
  payload?: ChartLegendEntry[]
}

export const ChartLegend = ({ payload = [] }: ChartLegendProps): ReactElement => (
  <ul className="nabu-chart-legend">
    {payload.map((entry) => (
      <li key={String(entry.value)} className="nabu-chart-legend-item">
        <span className="nabu-chart-legend-swatch" style={{ background: entry.color }} />
        {entry.value}
      </li>
    ))}
  </ul>
)
