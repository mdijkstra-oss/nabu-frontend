import type { FileStore } from "~/lib/files"
import { exhaustive } from "~/lib/utils/exhaustive"
import type { ComponentType } from "react"
import type { RadixColor } from "~/ui/theme/radix"
import type { EntityKind, EntityRef } from "./linkify/types"
import { parseEntityLink } from "./linkify/parse"
import { serializeSpotlight } from "~/lib/editor/spotlight"
import { BarChart, ChartLine, ChartPie, ChartScatter } from "lucide-react"
import type { ChartType } from "~/lib/chart/types"
import { calloutTypeIcons } from "~/domain/data-blocks/callout/schema"
import { annotationIcon } from "~/domain/data-blocks/attributes/schema"
import {
  lowContrastText,
  solidBackground,
  elementBackground,
  hoveredElementBackground,
} from "~/ui/theme/radix"
import { resolveIcon } from "~/ui/theme/icon-map"
import {
  findAnnotationById,
  findDocumentForAnnotation,
  getStoredAnnotations,
  resolveAnnotationColor,
} from "~/domain/data-blocks/attributes/annotations/selectors"
import { createBackground } from "~/lib/editor/annotations/gradient"
import { findMatchOffset } from "~/lib/text/find"
import { findCalloutById, findDocumentForCallout } from "~/domain/data-blocks/callout/selectors"
import { findChartById, findDocumentForChart } from "~/domain/data-blocks/chart/selectors"
import { findTagDefinitionById } from "~/domain/data-blocks/settings/tags/selectors"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"

export interface ResolvedColors {
  text: string
  icon: string
  background: string
  backgroundHover: string
}

export interface ResolvedLink {
  kind: EntityKind
  colors: ResolvedColors
  color?: string
  icon: ComponentType<{ className?: string }>
  url: string
  label: string
}

const radixColors = (color: RadixColor): ResolvedColors => ({
  text: lowContrastText(color),
  icon: solidBackground(color),
  background: elementBackground(color),
  backgroundHover: hoveredElementBackground(color),
})

const FILE_COLORS: ResolvedColors = {
  text: "var(--color-brand-700)",
  icon: "var(--color-brand-600)",
  background: "var(--color-brand-100)",
  backgroundHover: "var(--color-brand-200)",
}

const SPOTLIGHT_COLORS: ResolvedColors = {
  text: "var(--color-neutral-700)",
  icon: "var(--color-neutral-500)",
  background: "var(--color-neutral-200)",
  backgroundHover: "var(--color-neutral-300)",
}

const CHART_COLORS = FILE_COLORS

const SEARCH_COLORS: ResolvedColors = {
  text: "var(--color-brand-700)",
  icon: "var(--color-brand-600)",
  background: "var(--color-brand-100)",
  backgroundHover: "var(--color-brand-200)",
}

const buildEntityUrl = (projectId: string, documentId: string, entityId: string): string =>
  `/project/${projectId}/file/${documentId}?entity=${entityId}`

const buildTextUrl = (
  projectId: string,
  documentId: string,
  spotlight: { type: string } | null
): string => {
  const base = `/project/${projectId}/file/${documentId}`
  if (!spotlight) return base
  return `${base}?spotlight=${encodeURIComponent(serializeSpotlight(spotlight as Parameters<typeof serializeSpotlight>[0]))}`
}

const resolveAnnotationRef = (
  ref: Extract<EntityRef, { kind: "annotation" }>,
  files: FileStore,
  projectId: string
): ResolvedLink | null => {
  const annotation = findAnnotationById(files, ref.id)
  if (!annotation) return null
  const documentId = findDocumentForAnnotation(files, ref.id)
  if (!documentId) return null
  const color = resolveAnnotationColor(files, annotation)
  return {
    kind: "annotation",
    colors: radixColors(color),
    color,
    icon: annotationIcon,
    url: buildEntityUrl(projectId, documentId, ref.id),
    label: annotation.text,
  }
}

const resolveCalloutRef = (
  ref: Extract<EntityRef, { kind: "callout" }>,
  files: FileStore,
  projectId: string
): ResolvedLink | null => {
  const callout = findCalloutById(files, ref.id)
  if (!callout) return null
  const documentId = findDocumentForCallout(files, ref.id)
  if (!documentId) return null
  return {
    kind: "callout",
    colors: radixColors(callout.color),
    color: callout.color,
    icon: calloutTypeIcons[callout.type],
    url: buildEntityUrl(projectId, documentId, ref.id),
    label: callout.title,
  }
}

const resolveTagRef = (
  ref: Extract<EntityRef, { kind: "tag" }>,
  files: FileStore
): ResolvedLink | null => {
  const tag = findTagDefinitionById(files, ref.id)
  if (!tag) return null
  return {
    kind: "tag",
    colors: radixColors(tag.color),
    color: tag.color,
    icon: resolveIcon(tag.icon),
    url: "",
    label: tag.display,
  }
}

const CHART_TYPE_ICONS: Record<ChartType, ComponentType<{ className?: string }>> = {
  bar: BarChart,
  "stacked-bar": BarChart,
  "grouped-bar": BarChart,
  line: ChartLine,
  area: ChartLine,
  pie: ChartPie,
  treemap: ChartPie,
  scatter: ChartScatter,
  heatmap: ChartLine,
}

const resolveChartRef = (
  ref: Extract<EntityRef, { kind: "chart" }>,
  files: FileStore,
  projectId: string
): ResolvedLink | null => {
  const chart = findChartById(files, ref.id)
  if (!chart) return null
  const documentId = findDocumentForChart(files, ref.id)
  if (!documentId) return null
  return {
    kind: "chart",
    colors: CHART_COLORS,
    icon: CHART_TYPE_ICONS[chart.spec.type],
    url: buildEntityUrl(projectId, documentId, ref.id),
    label: chart.caption.label,
  }
}

const buildSearchUrl = (projectId: string, searchId: string): string =>
  `/project/${projectId}/search/${searchId}`

const resolveSearchRef = (
  ref: Extract<EntityRef, { kind: "search" }>,
  files: FileStore,
  projectId: string,
  icons: EntityIcons
): ResolvedLink | null => {
  const search = findSearchById(files, ref.id)
  if (!search) return null
  return {
    kind: "search",
    colors: SEARCH_COLORS,
    icon: icons.search ?? icons.file,
    url: buildSearchUrl(projectId, ref.id),
    label: search.title,
  }
}

const hasSpotlight = (ref: Extract<EntityRef, { kind: "text" }>): boolean => ref.spotlight !== null

const spotlightText = (ref: Extract<EntityRef, { kind: "text" }>): string | null => {
  if (!ref.spotlight) return null
  switch (ref.spotlight.type) {
    case "single":
      return ref.spotlight.text
    case "range":
      return ref.spotlight.from
  }
}

const hasMinWords = (text: string): boolean => text.trim().split(/\s+/).length >= 2

const isContainedIn =
  (needle: string) =>
  (a: { text: string }): boolean =>
    findMatchOffset(a.text, needle) !== null

const findContainingAnnotationColors = (
  files: FileStore,
  documentId: string,
  text: string
): string[] => {
  if (!hasMinWords(text)) return []
  const raw = files[documentId]
  if (!raw) return []
  const colors = getStoredAnnotations(raw)
    .filter(isContainedIn(text))
    .map((a) => resolveAnnotationColor(files, a))
  return [...new Set(colors)]
}

const barberPoleColors = (colors: string[]): ResolvedColors => ({
  text: lowContrastText(colors[0]),
  icon: solidBackground(colors[0]),
  background: createBackground(colors.map(elementBackground)),
  backgroundHover: createBackground(colors.map(hoveredElementBackground)),
})

const resolveSpotlightColors = (annotationColors: string[]): ResolvedColors => {
  if (annotationColors.length === 0) return SPOTLIGHT_COLORS
  if (annotationColors.length === 1) return radixColors(annotationColors[0])
  return barberPoleColors(annotationColors)
}

const resolveTextRef = (
  ref: Extract<EntityRef, { kind: "text" }>,
  files: FileStore,
  projectId: string,
  icons: EntityIcons
): ResolvedLink => {
  const text = spotlightText(ref)
  const annotationColors = text ? findContainingAnnotationColors(files, ref.documentId, text) : []
  return {
    kind: "text",
    colors: hasSpotlight(ref) ? resolveSpotlightColors(annotationColors) : FILE_COLORS,
    icon: hasSpotlight(ref) ? icons.spotlight : icons.file,
    url: buildTextUrl(projectId, ref.documentId, ref.spotlight),
    label: ref.documentId,
  }
}

export interface EntityIcons {
  file: ComponentType<{ className?: string }>
  spotlight: ComponentType<{ className?: string }>
  search?: ComponentType<{ className?: string }>
}

export const resolveEntityLink = (
  href: string,
  files: FileStore,
  projectId: string,
  icons: EntityIcons
): ResolvedLink | null => {
  const ref = parseEntityLink(href)
  if (!ref) return null

  switch (ref.kind) {
    case "annotation":
      return resolveAnnotationRef(ref, files, projectId)
    case "callout":
      return resolveCalloutRef(ref, files, projectId)
    case "chart":
      return resolveChartRef(ref, files, projectId)
    case "search":
      return resolveSearchRef(ref, files, projectId, icons)
    case "tag":
      return resolveTagRef(ref, files)
    case "text":
      return resolveTextRef(ref, files, projectId, icons)
    default:
      return exhaustive(ref)
  }
}
