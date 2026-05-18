import type { ReactNode } from "react"

export interface ToolbarButton {
  icon: ReactNode
  label: string
  onClick: () => void
  variant?: "default" | "ai" | "confirm"
}

export interface ToolbarConfig {
  title: string
  buttons: readonly ToolbarButton[]
}

export type ToolbarFactory = (meta: Record<string, string>) => ToolbarConfig
