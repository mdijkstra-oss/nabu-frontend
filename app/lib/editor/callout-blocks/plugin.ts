import { $view } from "@milkdown/utils"
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark"
import type { useNodeViewFactory } from "@prosemirror-adapter/react"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { getBlockConfig } from "~/lib/data-blocks/registry"
import { CalloutNodeView } from "./node-view"

const isRenderedBlock = (node: ProseMirrorNode): boolean => {
  const language = node.attrs.language as string | undefined
  const renderer = language ? getBlockConfig(language)?.renderer : undefined
  return renderer === "callout" || renderer === "chart"
}

export const createCalloutBlocksPlugin = (nodeViewFactory: ReturnType<typeof useNodeViewFactory>) =>
  $view(codeBlockSchema.node, () =>
    nodeViewFactory({
      component: CalloutNodeView,
      update: (newNode) => !isRenderedBlock(newNode),
    })
  )
