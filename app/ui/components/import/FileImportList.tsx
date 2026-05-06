"use client"

import React from "react"
import { Button } from "~/ui/components/Button"
import { Loader2, X } from "lucide-react"
import { FileImportItem } from "./FileImportItem"
import type { ImportFile, ImportProgress } from "~/lib/import/types"

interface FileImportListProps {
  files: ImportFile[]
  progress: ImportProgress & { processed: number }
  isProcessing: boolean
  onCancel?: () => void
}

export const FileImportList = ({
  files,
  progress,
  isProcessing,
  onCancel,
}: FileImportListProps) => {
  const progressPercent =
    progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0

  return (
    <div className="flex w-full flex-col items-start gap-6 rounded-lg border-4 border-dashed border-neutral-200 bg-neutral-50 px-8 py-8">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-3">
          {isProcessing && (
            <Loader2 className="text-heading-2 font-heading-2 text-default-font animate-spin" />
          )}
          <span className="text-heading-3 font-heading-3 text-default-font">
            {isProcessing ? "Processing files..." : "Import complete"}
          </span>
        </div>
        <span className="text-body font-body text-subtext-color">
          {progress.processed} of {progress.total} files processed
        </span>
      </div>

      <div className="flex w-full flex-col items-start gap-3 max-h-[400px] overflow-y-auto">
        {files.map((file) => (
          <FileImportItem key={file.id} file={file} />
        ))}
      </div>

      <div className="flex w-full flex-col items-start gap-2">
        <div className="flex h-2 w-full flex-none flex-col items-start gap-2 overflow-hidden rounded-full bg-neutral-200">
          <div
            className="flex h-full flex-col items-center gap-2 bg-brand-600 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex w-full items-center justify-between">
          <span className="text-caption font-caption text-subtext-color">
            {progress.completed} added
            {progress.failed > 0 && `, ${progress.failed} failed`}
            {progress.unsupported > 0 && `, ${progress.unsupported} unsupported`}
          </span>
          {isProcessing && onCancel && (
            <Button variant="neutral-tertiary" size="small" icon={<X />} onClick={onCancel}>
              Cancel all
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
