import { Decoration, DecorationSet } from "prosemirror-view"
import type { Node } from "prosemirror-model"
import type { useWidgetViewFactory } from "@prosemirror-adapter/react"
import { elementBackground, lowContrastText, subtleBackground } from "~/ui/theme/radix"
import { iconSides, type ResolvedRegion } from "./resolve"

export type WidgetViewFactory = ReturnType<typeof useWidgetViewFactory>
type WidgetDecorationFactory = ReturnType<WidgetViewFactory>

const labelStyle = (colour: string): string =>
  [
    `background: ${elementBackground(colour)}`,
    `color: ${lowContrastText(colour)}`,
    "font-weight: 600",
    "border-radius: 3px",
    "padding: 1px 2px",
  ].join("; ")

const toLabelDecoration = ({ region, labelFrom, labelTo }: ResolvedRegion): Decoration =>
  Decoration.inline(labelFrom, labelTo, {
    class: "region-label",
    style: labelStyle(region.colour),
    "data-region-kind": region.kind,
    "data-region-index": String(region.index),
    "aria-label": `${region.kind}: ${region.label}`,
  })

const toTintDecoration = ({ region, from, to }: ResolvedRegion): Decoration =>
  Decoration.inline(from, to, {
    class: "region-tint",
    style: `background: ${subtleBackground(region.colour)}`,
    "data-region-tint": String(region.index),
  })

const toIconDecoration = (
  widget: WidgetDecorationFactory,
  resolved: ResolvedRegion,
  side: number
): Decoration =>
  widget(resolved.labelFrom, {
    side,
    kind: resolved.region.kind,
    icon: resolved.region.icon,
    colour: resolved.region.colour,
  })

const hoveredIn = (resolved: ResolvedRegion[], hovered: number | null): ResolvedRegion[] =>
  hovered === null ? [] : resolved.filter((r) => r.region.index === hovered)

export const createRegionDecorations = (
  doc: Node,
  resolved: ResolvedRegion[],
  hovered: number | null,
  widget: WidgetDecorationFactory
): DecorationSet => {
  const sides = iconSides(resolved)
  return DecorationSet.create(doc, [
    ...hoveredIn(resolved, hovered).map(toTintDecoration),
    ...resolved.map(toLabelDecoration),
    ...resolved.map((r, i) => toIconDecoration(widget, r, sides[i])),
  ])
}
