"use client"

import { CHART_HEIGHT } from "./shared"

export const HeatmapPlaceholder = ({ height = CHART_HEIGHT }: { height?: number }) => (
  <div className="flex items-center justify-center text-sm text-subtext-color" style={{ height }}>
    Too cold for heatmap
  </div>
)
