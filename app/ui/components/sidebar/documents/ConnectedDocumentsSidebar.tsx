"use client"

import { useMemo, useSyncExternalStore } from "react"
import { getFiles, subscribe } from "~/lib/files/store"
import {
  getSelectedDocs,
  toggleSelectedDoc,
  selectionState,
  addIds,
  removeIds,
} from "~/domain/data-blocks/ux/selectors"
import { writeSelectedDocs } from "~/domain/actions/select-docs/apply"
import { DocumentsSidebar, type DocumentsSidebarProps } from "./DocumentsSidebar"

type ConnectedDocumentsSidebarProps = Omit<
  DocumentsSidebarProps,
  "selectedDocIds" | "onToggleDoc" | "onToggleTag"
>

export function ConnectedDocumentsSidebar(props: ConnectedDocumentsSidebarProps) {
  const files = useSyncExternalStore(subscribe, getFiles)
  const selectedDocs = useMemo(() => getSelectedDocs(files), [files])

  const toggleDoc = (id: string) => writeSelectedDocs(toggleSelectedDoc([...selectedDocs], id))

  const toggleTag = (ids: string[]) => {
    const current = [...selectedDocs]
    writeSelectedDocs(
      selectionState(selectedDocs, ids) === "all" ? removeIds(current, ids) : addIds(current, ids)
    )
  }

  return (
    <DocumentsSidebar
      {...props}
      selectedDocIds={selectedDocs}
      onToggleDoc={toggleDoc}
      onToggleTag={toggleTag}
    />
  )
}
