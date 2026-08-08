"use client"

import { useEffect, useMemo, useRef } from "react"
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/kit/core"
import { commonmark } from "@milkdown/kit/preset/commonmark"
import { gfm } from "@milkdown/kit/preset/gfm"
import { history } from "@milkdown/kit/plugin/history"
import { clipboard } from "@milkdown/kit/plugin/clipboard"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
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
import { createPlaceholderPlugin } from "~/lib/editor/placeholder/plugin"
import { createCalloutBlocksPlugin } from "~/lib/editor/callout-blocks/plugin"
import { AnnotationHover } from "./AnnotationHover"
import { FloatingToolbar } from "./FloatingToolbar"
import { ReadOnlyProvider } from "./ReadOnlyContext"
import { FilePathProvider } from "./FilePathContext"
import { DebugOptionsProvider } from "./DebugOptionsContext"
import type { DebugOptions } from "./debug-config"
import { useFiles } from "~/ui/hooks/useFiles"
import { normalizeAsStored } from "~/lib/files/store"
import {
  getAnnotations,
  selectVisibleAnnotations,
} from "~/domain/data-blocks/attributes/annotations/selectors"
import { getSelectedCodes } from "~/domain/data-blocks/ux/selectors"
import type { Spotlight } from "~/lib/editor/spotlight/types"
import { useStableRef } from "~/ui/hooks/useStableRef"

const readOnlyKey = new PluginKey("readOnly")

const createReadOnlyPlugin = () =>
  new Plugin({
    key: readOnlyKey,
    props: { editable: () => false },
  })

const normalizeSpotlights = (s: Spotlight | Spotlight[] | null | undefined): Spotlight[] =>
  s == null ? [] : Array.isArray(s) ? s : [s]

interface MilkdownEditorCoreProps {
  defaultValue: string
  debugMode: boolean
  readOnly: boolean
  spotlight: Spotlight | Spotlight[] | null
  filePath?: string
  onChange?: (markdown: string) => void
}

const MilkdownEditorCore = ({
  defaultValue,
  debugMode,
  readOnly,
  spotlight,
  filePath,
  onChange,
}: MilkdownEditorCoreProps) => {
  const { files } = useFiles()
  const nodeViewFactory = useNodeViewFactory()
  const annotationsPlugin = $prose(() => createAnnotationsPlugin())
  const spotlightPlugin = $prose(() => createSpotlightPlugin())
  const selectionPlugin = $prose(() => createSelectionPlugin(filePath ?? null))
  const hiddenBlocksPlugin = $prose(() => createHiddenBlocksPlugin())
  const placeholderPlugin = $prose(() => createPlaceholderPlugin())
  const gapCursorPlugin = $prose(gapCursor)
  const calloutBlocksPlugin = createCalloutBlocksPlugin(nodeViewFactory)
  const prevContentRef = useRef(defaultValue)
  // The editor is only rebuilt on debugMode/readOnly changes; a ref keeps the
  // listener pointed at the latest callback without a rebuild.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  const [loading, getEditor] = useInstance()
  const selectedCodes = useMemo(() => getSelectedCodes(files), [files])
  const rawAnnotations = useMemo(
    () => selectVisibleAnnotations(getAnnotations(files, defaultValue), selectedCodes),
    [files, defaultValue, selectedCodes]
  )
  const annotations = useStableRef(rawAnnotations)
  const spotlights = useStableRef(normalizeSpotlights(spotlight))

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
        editor
          .config((ctx) => {
            ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
              // Emit the store's canonical form (serialization differs: remark
              // space-indents nested lists, the store tabifies), set before
              // notifying: when the store echoes it back as defaultValue, the
              // contentChanged check stays false and replaceAll (which would
              // reset the cursor) does not fire.
              const canonical = normalizeAsStored(markdown)
              if (canonical === prevContentRef.current) return
              prevContentRef.current = canonical
              onChangeRef.current?.(canonical)
            })
          })
          .use(listener)
          .use(history)
          .use(clipboard)
          .use(gapCursorPlugin)
          .use(placeholderPlugin)
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
        .setMeta(spotlightMeta, spotlights)
      view.dispatch(tr)
    })
  }, [loading, getEditor, defaultValue, annotations, spotlights])

  return (
    <FloatingToolbar>
      <AnnotationHover annotations={annotations} filePath={filePath}>
        <Milkdown />
      </AnnotationHover>
    </FloatingToolbar>
  )
}

interface MilkdownEditorProps {
  content: string
  debugMode?: boolean
  debugOptions?: DebugOptions
  readOnly?: boolean
  spotlight?: Spotlight | Spotlight[] | null
  filePath?: string
  onChange?: (markdown: string) => void
}

export const MilkdownEditor = ({
  content,
  debugMode = false,
  debugOptions,
  readOnly = false,
  spotlight = null,
  filePath,
  onChange,
}: MilkdownEditorProps) => {
  const containerClass = readOnly
    ? "w-full text-default-font"
    : "w-full max-w-[768px] text-default-font"
  const editor = (
    <div className={containerClass} data-file-path={filePath}>
      <MilkdownProvider>
        <ProsemirrorAdapterProvider>
          <MilkdownEditorCore
            defaultValue={content}
            debugMode={debugMode}
            readOnly={readOnly}
            spotlight={spotlight}
            filePath={filePath}
            onChange={onChange}
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
