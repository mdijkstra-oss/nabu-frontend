"use client"

import React from "react"
import { IconWithBackground } from "~/ui/components/IconWithBackground"
import { Check, Clock, FileText, Loader2, AlertCircle, FileX } from "lucide-react"
import type { ImportFile, ImportStatus } from "~/lib/import/types"

interface StatusConfig {
  iconVariant: "success" | "brand" | "neutral" | "error" | "warning"
  label: string
  labelClass: string
  showSpinner?: boolean
}

const statusConfigs: Record<ImportStatus, StatusConfig> = {
  pending: {
    iconVariant: "neutral",
    label: "Queued",
    labelClass: "text-subtext-color",
  },
  reading: {
    iconVariant: "brand",
    label: "Reading...",
    labelClass: "text-brand-600",
    showSpinner: true,
  },
  processing: {
    iconVariant: "brand",
    label: "Processing...",
    labelClass: "text-brand-600",
    showSpinner: true,
  },
  completed: {
    iconVariant: "success",
    label: "Added",
    labelClass: "text-success-600",
  },
  unsupported: {
    iconVariant: "warning",
    label: "Not supported",
    labelClass: "text-warning-600",
  },
  error: {
    iconVariant: "error",
    label: "Failed",
    labelClass: "text-error-600",
  },
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const isPending = (status: ImportStatus): boolean => status === "pending"

const isActive = (status: ImportStatus): boolean => status === "reading" || status === "processing"

interface StatusIconProps {
  status: ImportStatus
  className: string
}

const StatusIcon = ({ status, className }: StatusIconProps) => {
  switch (status) {
    case "pending":
      return <Clock className={className} />
    case "reading":
    case "processing":
      return <Loader2 className={`${className} animate-spin`} />
    case "completed":
      return <Check className={className} />
    case "unsupported":
      return <FileX className={className} />
    case "error":
      return <AlertCircle className={className} />
    default:
      throw new Error(`Unknown status: ${status}`)
  }
}

interface FileImportItemProps {
  file: ImportFile
}

export const FileImportItem = ({ file }: FileImportItemProps) => {
  const config = statusConfigs[file.status]
  const opacity = isPending(file.status) ? "opacity-50" : ""
  const borderClass = isActive(file.status)
    ? "border-brand-100 bg-brand-50"
    : "border-neutral-border bg-default-background"

  return (
    <div
      className={`flex w-full items-center gap-4 rounded-md border border-solid px-4 py-3 shadow-sm ${borderClass} ${opacity}`}
    >
      <IconWithBackground variant={config.iconVariant} size="medium" icon={<FileText />} />
      <div className="flex grow shrink-0 basis-0 flex-col items-start">
        <span className="text-body-bold font-body-bold text-default-font">
          {file.finalPath ?? file.name}
        </span>
        <span className="text-caption font-caption text-subtext-color">
          {formatFileSize(file.size)}
          {file.error && ` - ${file.error}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <StatusIcon status={file.status} className={`text-body font-body ${config.labelClass}`} />
        <span className={`text-body-bold font-body-bold ${config.labelClass}`}>{config.label}</span>
      </div>
    </div>
  )
}
