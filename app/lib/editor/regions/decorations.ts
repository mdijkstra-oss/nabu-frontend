import { Decoration, DecorationSet } from "prosemirror-view"
import type { Node } from "prosemirror-model"
import type { useWidgetViewFactory } from "@prosemirror-adapter/react"
import { elementBackground, hoveredElementBorder, lowContrastText } from "~/ui/theme/radix"
import { iconSides, type ResolvedRegion } from "./resolve"

export type WidgetViewFactory = ReturnType<typeof useWidgetViewFactory>
type WidgetDecorationFactory = ReturnType<WidgetViewFactory>

// The icon widget forms the pill's left cap, so the label draws no left edge of its own.
// The box is shared by the pill and its muted state so hovering never shifts the text.
const LABEL_BOX = [
  "border-left: none",
  "font-weight: 600",
  "border-radius: 0 3px 3px 0 !important",
  "padding: 1px 2px",
  "margin-right: 2px",
]

// Overlapping inline decorations merge into one span with the annotation's style appended
// after this one; !important keeps the pill's own colour on top. The pill's border pokes
// past the line box, so it is positioned to paint above the next line's backgrounds.
const labelStyle = (colour: string): string =>
  [
    `background: ${elementBackground(colour)} !important`,
    `color: ${lowContrastText(colour)}`,
    `border: 1px solid ${hoveredElementBorder(colour)}`,
    "position: relative",
    "z-index: 1",
    ...LABEL_BOX,
  ].join("; ")

// A muted label sits inside another region's hovered range: the tint band colours it,
// and a transparent border keeps the box the pill's size so nothing shifts.
const MUTED_LABEL_STYLE = ["border: 1px solid transparent", ...LABEL_BOX].join("; ")

const toLabelDecoration = (
  { region, labelFrom, labelTo }: ResolvedRegion,
  muted: boolean
): Decoration =>
  Decoration.inline(labelFrom, labelTo, {
    class: "region-label",
    style: muted ? MUTED_LABEL_STYLE : labelStyle(region.colour),
    "data-region-kind": region.kind,
    "data-region-index": String(region.index),
    "aria-label": `${region.kind}: ${region.label}`,
  })

const toTintDecoration = ({ region, from, to }: ResolvedRegion): Decoration =>
  Decoration.inline(from, to, {
    class: "region-tint",
    style: `background: ${elementBackground(region.colour)} !important`,
    "data-region-tint": String(region.index),
  })

const toIconDecoration = (
  widget: WidgetDecorationFactory,
  resolved: ResolvedRegion,
  side: number,
  muted: boolean,
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
    muted,
    atBlockStart,
    hovered,
    searchable,
  })

const hoveredIn = (resolved: ResolvedRegion[], hovered: number | null): ResolvedRegion[] =>
  hovered === null ? [] : resolved.filter((r) => r.region.index === hovered)

const insideHovered = (hovered: ResolvedRegion[], r: ResolvedRegion): boolean =>
  hovered.some(
    (h) => h.region.index !== r.region.index && r.labelFrom >= h.from && r.labelTo <= h.to
  )

export const createRegionDecorations = (
  doc: Node,
  resolved: ResolvedRegion[],
  hovered: number | null,
  widget: WidgetDecorationFactory,
  searchable: boolean
): DecorationSet => {
  const hoveredRegions = hoveredIn(resolved, hovered)
  const muted = resolved.map((r) => insideHovered(hoveredRegions, r))
  const sides = iconSides(resolved)
  return DecorationSet.create(doc, [
    ...hoveredRegions.map(toTintDecoration),
    ...resolved.map((r, i) => toLabelDecoration(r, muted[i])),
    ...resolved.map((r, i) =>
      toIconDecoration(
        widget,
        r,
        sides[i],
        muted[i],
        doc.resolve(r.labelFrom).parentOffset === 0,
        r.region.index === hovered,
        searchable
      )
    ),
  ])
}
