"use client"

import { useFiles } from "~/ui/hooks/useFiles"
import {
  getSelectedDocs,
  toggleSelectedDoc,
  selectionState,
  addIds,
  removeIds,
} from "~/domain/data-blocks/ux/selectors"
import { writeSelectedDocs } from "~/domain/actions/select-docs/apply"
import { useSelection } from "../useSelection"
import { DocumentsSidebar, type DocumentsSidebarProps } from "./DocumentsSidebar"

type ConnectedDocumentsSidebarProps = Omit<
  DocumentsSidebarProps,
  "selectedDocIds" | "onToggleDoc" | "onToggleTag"
>

export function ConnectedDocumentsSidebar(props: ConnectedDocumentsSidebarProps) {
  const { files } = useFiles()
  const { selected: selectedDocs, toggleSelection: toggleDoc } = useSelection(
    files,
    getSelectedDocs,
    toggleSelectedDoc,
    writeSelectedDocs
  )

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
