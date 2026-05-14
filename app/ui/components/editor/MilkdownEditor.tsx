"use client"

import { useEffect, useMemo, useRef } from "react"
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/kit/core"
import { commonmark } from "@milkdown/kit/preset/commonmark"
import { gfm } from "@milkdown/kit/preset/gfm"
import { history } from "@milkdown/kit/plugin/history"
import { clipboard } from "@milkdown/kit/plugin/clipboard"
import { gapCursor } from "@milkdown/kit/prose/gapcursor"
import "@milkdown/kit/prose/gapcursor/style/gapcursor.css"
import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react"
import { ProsemirrorAdapterProvider, useNodeViewFactory } from "@prosemirror-adapter/react"
import { $prose, replaceAll } from "@milkdown/utils"
import { Plugin, PluginKey } from "prosemirror-state"
import { createAnnotationsPlugin, annotationsMeta } from "~/lib/editor/annotations/plugin"
import { createSpotlightPlugin, spotlightMeta } from "~/lib/editor/spotlight/plugin"
import { createSelectionPlugin } from "~/lib/editor/selection/plugin"
import { createHiddenBlocksPlugin } from "~/lib/editor/hidden-blocks/plugin"
import { createCalloutBlocksPlugin } from "~/lib/editor/callout-blocks/plugin"
import { AnnotationHover } from "./AnnotationHover"
import { ReadOnlyProvider } from "./ReadOnlyContext"
import { FilePathProvider } from "./FilePathContext"
import { DebugOptionsProvider } from "./DebugOptionsContext"
import type { DebugOptions } from "./debug-config"
import { useFiles } from "~/ui/hooks/useFiles"
import {
  getAnnotations,
  type Annotation,
} from "~/domain/data-blocks/attributes/annotations/selectors"
import { getSelectedCodes } from "~/domain/data-blocks/ux/selectors"
import type { Spotlight } from "~/lib/editor/spotlight/types"

const isAnnotationVisible = (selected: Set<string>, annotation: Annotation): boolean =>
  selected.size === 0 || (!!annotation.code && selected.has(annotation.code))

const filterAnnotationsBySelectedCodes = (
  annotations: Annotation[],
  selected: Set<string>
): Annotation[] => annotations.filter((a) => isAnnotationVisible(selected, a))

const readOnlyKey = new PluginKey("readOnly")

const createReadOnlyPlugin = () =>
  new Plugin({
    key: readOnlyKey,
    props: { editable: () => false },
  })

interface MilkdownEditorCoreProps {
  defaultValue: string
  debugMode: boolean
  readOnly: boolean
  spotlight: Spotlight | null
  filePath?: string
}

const MilkdownEditorCore = ({
  defaultValue,
  debugMode,
  readOnly,
  spotlight,
  filePath,
}: MilkdownEditorCoreProps) => {
  const { files } = useFiles()
  const nodeViewFactory = useNodeViewFactory()
  const annotationsPlugin = $prose(() => createAnnotationsPlugin())
  const spotlightPlugin = $prose(() => createSpotlightPlugin())
  const selectionPlugin = $prose(() => createSelectionPlugin())
  const hiddenBlocksPlugin = $prose(() => createHiddenBlocksPlugin())
  const gapCursorPlugin = $prose(gapCursor)
  const calloutBlocksPlugin = createCalloutBlocksPlugin(nodeViewFactory)
  const prevContentRef = useRef(defaultValue)
  const [loading, getEditor] = useInstance()
  const selectedCodes = useMemo(() => getSelectedCodes(files), [files])
  const annotations = useMemo(
    () => filterAnnotationsBySelectedCodes(getAnnotations(files, defaultValue), selectedCodes),
    [files, defaultValue, selectedCodes]
  )

  const readOnlyPlugin = $prose(createReadOnlyPlugin)

  useEditor(
    (root) => {
      const editor = Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, defaultValue)
        })
        .use(commonmark)
        .use(gfm)
        .use(annotationsPlugin)
        .use(spotlightPlugin)
        .use(selectionPlugin)

      if (readOnly) {
        editor.use(readOnlyPlugin)
      } else {
        editor.use(history).use(clipboard).use(gapCursorPlugin)
      }

      if (debugMode) return editor

      return editor.use(hiddenBlocksPlugin).use(calloutBlocksPlugin)
    },
    [debugMode, readOnly]
  )

  useEffect(() => {
    if (loading) return
    const editor = getEditor()
    if (!editor) return

    const contentChanged = defaultValue !== prevContentRef.current
    prevContentRef.current = defaultValue

    if (contentChanged) {
      editor.action(replaceAll(defaultValue))
    }
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const tr = view.state.tr
        .setMeta(annotationsMeta, annotations)
        .setMeta(spotlightMeta, spotlight)
      view.dispatch(tr)
    })
  }, [loading, getEditor, defaultValue, annotations, spotlight])

  return (
    <AnnotationHover annotations={annotations} filePath={filePath}>
      <Milkdown />
    </AnnotationHover>
  )
}

interface MilkdownEditorProps {
  content: string
  debugMode?: boolean
  debugOptions?: DebugOptions
  readOnly?: boolean
  spotlight?: Spotlight | null
  filePath?: string
}

export const MilkdownEditor = ({
  content,
  debugMode = false,
  debugOptions,
  readOnly = false,
  spotlight = null,
  filePath,
}: MilkdownEditorProps) => {
  const containerClass = readOnly
    ? "w-full text-default-font"
    : "w-full max-w-[768px] text-default-font"
  const editor = (
    <div className={containerClass}>
      <MilkdownProvider>
        <ProsemirrorAdapterProvider>
          <MilkdownEditorCore
            defaultValue={content}
            debugMode={debugMode}
            readOnly={readOnly}
            spotlight={spotlight}
            filePath={filePath}
          />
        </ProsemirrorAdapterProvider>
      </MilkdownProvider>
    </div>
  )

  return (
    <ReadOnlyProvider value={readOnly}>
      <FilePathProvider value={filePath}>
        {debugOptions ? (
          <DebugOptionsProvider value={debugOptions}>{editor}</DebugOptionsProvider>
        ) : (
          editor
        )}
      </FilePathProvider>
    </ReadOnlyProvider>
  )
}
