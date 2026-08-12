import { PluginKey, type Plugin } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { exhaustive } from "~/lib/utils/exhaustive"
import { createDecorationPlugin, getPluginInput } from "~/lib/editor/decoration-plugin"
import { createRegionDecorations, type WidgetViewFactory } from "./decorations"
import { RegionIcon } from "./icon"
import { resolveRegions } from "./resolve"
import type { RegionsInput, RegionsMessage, RenderableRegion } from "./types"

const pluginKey = new PluginKey("regions")

export const regionsMeta = pluginKey

const EMPTY_INPUT: RegionsInput = { regions: [], sentences: [], hovered: null }

const isStillPresent = (regions: RenderableRegion[], hovered: number | null): boolean =>
  hovered !== null && regions.some((r) => r.index === hovered)

const reduceRegions = (input: RegionsInput, message: RegionsMessage): RegionsInput => {
  switch (message.type) {
    case "regions":
      return {
        regions: message.regions,
        sentences: message.sentences,
        hovered: isStillPresent(message.regions, input.hovered) ? input.hovered : null,
      }
    case "hover":
      return { ...input, hovered: message.index }
    default:
      return exhaustive(message)
  }
}

const regionIndexAt = (target: EventTarget | null): number | null => {
  if (!(target instanceof Element)) return null
  const labelled = target.closest("[data-region-index]")
  if (!labelled) return null
  const index = Number(labelled.getAttribute("data-region-index"))
  return Number.isNaN(index) ? null : index
}

const hover = (view: EditorView, index: number | null): boolean => {
  const input = getPluginInput<RegionsInput>(pluginKey, view.state)
  if (!input || input.hovered === index) return false
  view.dispatch(
    view.state.tr
      .setMeta(pluginKey, { type: "hover", index } satisfies RegionsMessage)
      .setMeta("addToHistory", false)
  )
  return false
}

export const createRegionsPlugin = (widgetViewFactory: WidgetViewFactory): Plugin => {
  const widget = widgetViewFactory({ as: "span", component: RegionIcon })
  return createDecorationPlugin<RegionsInput, RegionsMessage>({
    key: pluginKey,
    initial: EMPTY_INPUT,
    reduce: reduceRegions,
    compute: (doc, input) =>
      createRegionDecorations(
        doc,
        resolveRegions(doc, input.sentences, input.regions),
        input.hovered,
        widget
      ),
    props: {
      handleDOMEvents: {
        mouseover: (view, event) => hover(view, regionIndexAt(event.target)),
        mouseout: (view, event) => hover(view, regionIndexAt(event.relatedTarget)),
      },
    },
  })
}
