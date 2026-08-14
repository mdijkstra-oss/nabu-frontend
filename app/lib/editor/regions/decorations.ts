import { Decoration, DecorationSet } from "prosemirror-view"
import type { Node } from "prosemirror-model"
import type { useWidgetViewFactory } from "@prosemirror-adapter/react"
import { elementBackground, radixVar } from "~/ui/theme/radix"
import { iconSides, type ResolvedRegion } from "./resolve"

export type WidgetViewFactory = ReturnType<typeof useWidgetViewFactory>
type WidgetDecorationFactory = ReturnType<WidgetViewFactory>

// Overlapping inline decorations merge into one span; !important keeps the label's
// darker highlight on top of any annotation background.
const highlightStyle = (colour: string): string => `background: ${radixVar(colour, 5)} !important`

const toLabelDecoration = ({ region, labelFrom, labelTo }: ResolvedRegion, hovered: boolean) =>
  Decoration.inline(labelFrom, labelTo, {
    class: "region-label",
    ...(hovered ? { style: highlightStyle(region.colour) } : {}),
    "data-region-kind": region.kind,
    "data-region-index": String(region.index),
    "aria-label": `${region.kind}: ${region.label}`,
  })

// The region's own label draws the darker highlight, so the tint skips that range —
// two competing !important backgrounds on one span would resolve by merge order,
// which is not the order the decorations are listed in.
const toTintDecorations = ({
  region,
  from,
  to,
  labelFrom,
  labelTo,
}: ResolvedRegion): Decoration[] =>
  [
    { from, to: Math.min(labelFrom, to) },
    { from: Math.max(labelTo, from), to },
  ]
    .filter((span) => span.from < span.to)
    .map((span) =>
      Decoration.inline(span.from, span.to, {
        class: "region-tint",
        style: `background: ${elementBackground(region.colour)} !important`,
        "data-region-tint": String(region.index),
      })
    )

const toIconDecoration = (
  widget: WidgetDecorationFactory,
  resolved: ResolvedRegion,
  side: number,
  atBlockStart: boolean,
  hovered: boolean,
  searchable: boolean
): Decoration =>
  widget(resolved.labelFrom, {
    side,
    index: resolved.region.index,
    kind: resolved.region.kind,
    label: resolved.region.label,
    icon: resolved.region.icon,
    colour: resolved.region.colour,
    atBlockStart,
    hovered,
    searchable,
  })

const hoveredIn = (resolved: ResolvedRegion[], hovered: number | null): ResolvedRegion[] =>
  hovered === null ? [] : resolved.filter((r) => r.region.index === hovered)

export const createRegionDecorations = (
  doc: Node,
  resolved: ResolvedRegion[],
  hovered: number | null,
  widget: WidgetDecorationFactory,
  searchable: boolean
): DecorationSet => {
  const sides = iconSides(resolved)
  return DecorationSet.create(doc, [
    ...hoveredIn(resolved, hovered).flatMap(toTintDecorations),
    ...resolved.map((r) => toLabelDecoration(r, r.region.index === hovered)),
    ...resolved.map((r, i) =>
      toIconDecoration(
        widget,
        r,
        sides[i],
        doc.resolve(r.labelFrom).parentOffset === 0,
        r.region.index === hovered,
        searchable
      )
    ),
  ])
}
