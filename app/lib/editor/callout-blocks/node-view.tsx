"use client"

import { useRef, useMemo, useEffect } from "react"
import { useNodeViewContext, type NodeViewContentRef } from "@prosemirror-adapter/react"
import type { DecorationSet } from "prosemirror-view"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { getBlockConfig, getCaptionType } from "~/lib/data-blocks/registry"
import { findCaptionIndex, type CaptionEntry } from "~/lib/data-blocks/caption"
import { parseCallout } from "~/domain/data-blocks/callout/schema"
import { parseChart } from "~/domain/data-blocks/chart/schema"
import { useIsReadOnly } from "~/ui/components/editor/ReadOnlyContext"
import { CalloutBlockView } from "./view"
import { ChartBlockView } from "~/lib/editor/chart-blocks/view"
import { applyDOMHighlights, type HighlightEntry } from "./highlight"

interface BlockSpacerProps {
  onClick: () => void
}

const BlockSpacer = ({ onClick }: BlockSpacerProps) => (
  <div
    className="h-2 w-full cursor-text hover:bg-neutral-100 transition-colors rounded"
    onClick={onClick}
  />
)

interface CodeBlockFallbackProps {
  language: string | undefined
  contentRef: NodeViewContentRef
  invalid?: boolean
}

const CodeBlockFallback = ({ language, contentRef, invalid }: CodeBlockFallbackProps) => (
  <pre className={`code-block${invalid ? " code-block-invalid" : ""}`} data-language={language}>
    <code ref={contentRef} />
  </pre>
)

const extractHighlights = (innerDecorations: unknown, textContent: string): HighlightEntry[] => {
  const decoSet = innerDecorations as DecorationSet
  if (!decoSet.find) return []
  return decoSet
    .find()
    .map((d) => ({
      text: textContent.slice(d.from, d.to),
      isSpotlight: d.spec?.spotlight === true,
    }))
    .filter((e) => e.text.length > 0)
}

const collectCaptionEntries = (doc: ProseMirrorNode): CaptionEntry[] => {
  const entries: CaptionEntry[] = []
  doc.forEach((node, offset) => {
    const language = node.attrs?.language as string | undefined
    if (!language) return
    const ct = getCaptionType(language)
    if (ct) entries.push({ captionType: ct, pos: offset })
  })
  return entries
}

export const CalloutNodeView = () => {
  const { node, view, getPos, contentRef, innerDecorations } = useNodeViewContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const isReadOnly = useIsReadOnly()

  const language = node.attrs.language as string | undefined
  const config = language ? getBlockConfig(language) : undefined
  const renderer = config?.renderer
  const isCallout = renderer === "callout"
  const isChart = renderer === "chart"

  const calloutData = isCallout ? parseCallout(node.textContent) : null
  const chartData = isChart ? parseChart(node.textContent) : null

  const highlights = useMemo(
    () => (isCallout ? extractHighlights(innerDecorations, node.textContent) : []),
    [isCallout, innerDecorations, node.textContent]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || !calloutData || highlights.length === 0) return
    return applyDOMHighlights(container, calloutData.id, highlights)
  }, [calloutData, highlights])

  const isRendered = isCallout || isChart
  const hasData = calloutData || chartData
  const isInvalid = isRendered && !hasData

  if (!isRendered || !hasData) {
    return <CodeBlockFallback language={language} contentRef={contentRef} invalid={isInvalid} />
  }

  const handleDelete = () => {
    const pos = getPos()
    if (pos === undefined) return
    const tr = view.state.tr.delete(pos, pos + node.nodeSize)
    view.dispatch(tr)
  }

  const handleInsertBefore = () => {
    const pos = getPos()
    if (pos === undefined) return
    const paragraph = view.state.schema.nodes.paragraph.create()
    const tr = view.state.tr.insert(pos, paragraph)
    view.dispatch(tr)
    view.focus()
  }

  if (isChart && chartData) {
    const captionType = config?.captionType
    const pos = getPos()
    const captionIndex =
      captionType && pos !== undefined
        ? findCaptionIndex(collectCaptionEntries(view.state.doc), pos, captionType)
        : 0

    return (
      <>
        {!isReadOnly && <BlockSpacer onClick={handleInsertBefore} />}
        <div contentEditable={false} data-id={chartData.id}>
          <ChartBlockView
            data={chartData}
            onDelete={handleDelete}
            captionType={captionType}
            captionIndex={captionIndex}
          />
        </div>
      </>
    )
  }

  const data = calloutData as NonNullable<typeof calloutData>

  return (
    <>
      {!isReadOnly && <BlockSpacer onClick={handleInsertBefore} />}
      <div ref={containerRef} contentEditable={false} data-id={data.id}>
        <CalloutBlockView data={data} onDelete={handleDelete} readOnly={isReadOnly} />
      </div>
    </>
  )
}
