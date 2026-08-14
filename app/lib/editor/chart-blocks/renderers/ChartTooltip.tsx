"use client"

import type { ReactElement } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { allowFileProtocol } from "~/ui/components/nabu/MessageContent"
import { createEntityLinkComponents } from "~/ui/components/markdown/createEntityLinkComponents"
import type { FileStore } from "~/lib/files/store"
import { resolveTemplateToMarkdown } from "~/lib/chart/template"
import type { ChartEntityMap, TemplateNode } from "~/lib/chart/types"

export interface ChartTooltipContext {
  files: FileStore
  projectId: string | null
  entityMap: ChartEntityMap
  navigate?: (url: string) => void
}

interface TooltipDatum {
  _raw: Record<string, unknown>
  _tooltipNodes?: TemplateNode[]
}

export interface RechartsPayloadItem {
  payload?: TooltipDatum
  name?: string
  value?: number | string
  color?: string
}

export interface RechartsTooltipContentProps {
  active?: boolean
  payload?: RechartsPayloadItem[]
  label?: string | number
}

export type RechartsTooltipContent = (props: RechartsTooltipContentProps) => ReactElement | null

export interface ChartTooltipProps extends RechartsTooltipContentProps {
  context: ChartTooltipContext
}

const remarkPlugins = [remarkGfm]

const extractDatum = (payload: RechartsPayloadItem[] | undefined): TooltipDatum | undefined =>
  payload && payload.length > 0 ? payload[0].payload : undefined

const formatFallbackValue = (value: number | string | undefined): string =>
  value === undefined || value === null ? "" : String(value)

const buildFallbackContent = (
  payload: RechartsPayloadItem[],
  label: string | number | undefined
): string => {
  const header = label !== undefined && label !== "" ? `**${label}**\n\n` : ""
  const lines = payload
    .map((item) => `- ${item.name ?? ""}: ${formatFallbackValue(item.value)}`)
    .join("\n")
  return `${header}${lines}`
}

const buildTooltipMarkdown = (
  payload: RechartsPayloadItem[],
  label: string | number | undefined,
  datum: TooltipDatum,
  entityMap: ChartEntityMap
): string => {
  if (!datum._tooltipNodes || datum._tooltipNodes.length === 0) {
    return buildFallbackContent(payload, label)
  }
  return resolveTemplateToMarkdown(datum._tooltipNodes, {
    row: datum._raw,
    entityMap,
  })
}

export const ChartTooltip = ({ context, active, payload, label }: ChartTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null
  const datum = extractDatum(payload)
  if (!datum) return null

  const components = createEntityLinkComponents({
    files: context.files,
    projectId: context.projectId,
    navigate: context.navigate,
  })
  const markdown = buildTooltipMarkdown(payload, label, datum, context.entityMap)

  return (
    <div className="rounded border border-solid border-neutral-border bg-default-background px-3 py-2 text-xs shadow-md">
      <Markdown
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={allowFileProtocol}
      >
        {markdown}
      </Markdown>
    </div>
  )
}

export const buildChartTooltipContent =
  (context: ChartTooltipContext): RechartsTooltipContent =>
  (props) => <ChartTooltip context={context} {...props} />
