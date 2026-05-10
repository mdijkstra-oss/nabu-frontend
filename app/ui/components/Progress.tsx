"use client"

import React from "react"
import * as SubframeCore from "@subframe/core"
import { cn } from "~/ui/utils"

interface IndicatorProps extends React.ComponentProps<typeof SubframeCore.Progress.Indicator> {
  className?: string
}

const Indicator = React.forwardRef<HTMLDivElement, IndicatorProps>(function Indicator(
  { className, ...otherProps }: IndicatorProps,
  ref
) {
  return (
    <SubframeCore.Progress.Indicator asChild={true} {...otherProps}>
      <div
        className={cn(
          "flex h-2 w-full flex-col items-start gap-2 rounded-full bg-slate-950 transition-[width] duration-500 ease-out",
          className
        )}
        ref={ref}
      />
    </SubframeCore.Progress.Indicator>
  )
})

interface ProgressRootProps extends React.ComponentProps<typeof SubframeCore.Progress.Root> {
  value?: number
  className?: string
}

const ProgressRoot = React.forwardRef<HTMLDivElement, ProgressRootProps>(function ProgressRoot(
  { value = 30, className, ...otherProps }: ProgressRootProps,
  ref
) {
  return (
    <SubframeCore.Progress.Root asChild={true} value={value} {...otherProps}>
      <div
        className={cn(
          "flex h-2 w-full flex-col items-start overflow-hidden rounded-full bg-neutral-100",
          className
        )}
        ref={ref}
      >
        <Indicator />
      </div>
    </SubframeCore.Progress.Root>
  )
})

export const Progress = Object.assign(ProgressRoot, {
  Indicator,
})
