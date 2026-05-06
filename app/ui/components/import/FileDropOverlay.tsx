"use client"

import React from "react"
import { Button } from "~/ui/components/Button"
import { DropZone } from "./DropZone"
import { FileImportList } from "./FileImportList"
import { X } from "lucide-react"
import type { ImportFile, ImportProgress } from "~/lib/import/types"

interface FileDropOverlayProps {
  isVisible: boolean
  isDragging: boolean
  files: ImportFile[]
  progress: ImportProgress & { processed: number }
  isProcessing: boolean
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
  onDismiss: () => void
}

const hasFiles = (files: ImportFile[]): boolean => files.length > 0

const isComplete = (progress: ImportProgress & { processed: number }): boolean =>
  progress.total > 0 && progress.processed === progress.total

export const FileDropOverlay = ({
  isVisible,
  isDragging,
  files,
  progress,
  isProcessing,
  dragHandlers,
  onDismiss,
}: FileDropOverlayProps) => {
  if (!isVisible) return null

  const showList = hasFiles(files)
  const canDismiss = !isProcessing && isComplete(progress)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      {...dragHandlers}
    >
      <div className="flex w-full max-w-2xl flex-col items-start gap-6 rounded-xl bg-default-background p-8 shadow-2xl mx-4">
        <div className="flex w-full items-center justify-between">
          <span className="text-heading-2 font-heading-2 text-default-font">Import Documents</span>
          {canDismiss && (
            <Button variant="neutral-tertiary" size="small" icon={<X />} onClick={onDismiss}>
              Close
            </Button>
          )}
        </div>

        <DropZone
          variant={showList ? "compact" : "full"}
          isDragging={isDragging}
          dragHandlers={dragHandlers}
        />

        {showList && (
          <FileImportList files={files} progress={progress} isProcessing={isProcessing} />
        )}
      </div>
    </div>
  )
}
