import { $view } from "@milkdown/utils"
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark"
import type { useNodeViewFactory } from "@prosemirror-adapter/react"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { getBlockConfig } from "~/lib/data-blocks/registry"
import { CalloutNodeView } from "./node-view"

const rendererOf = (node: ProseMirrorNode): string | undefined => {
  const language = node.attrs.language as string | undefined
  return language ? getBlockConfig(language)?.renderer : undefined
}

const isRenderedBlock = (node: ProseMirrorNode): boolean => {
  const renderer = rendererOf(node)
  return renderer === "callout" || renderer === "chart" || renderer === "table"
}

// Returning false tears the React tree down and re-mounts it. A grid cannot
// survive that — every cell commit would drop focus and break Tab — so a table
// node reconciles instead, and only a table node needs to.
const shouldReconcile = (node: ProseMirrorNode): boolean => rendererOf(node) === "table"

export const createCalloutBlocksPlugin = (nodeViewFactory: ReturnType<typeof useNodeViewFactory>) =>
  $view(codeBlockSchema.node, () =>
    nodeViewFactory({
      component: CalloutNodeView,
      update: (newNode) => shouldReconcile(newNode) || !isRenderedBlock(newNode),
    })
  )
