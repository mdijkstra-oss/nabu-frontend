"use client"

import React from "react"
import * as SubframeCore from "@subframe/core"
import { cn } from "~/ui/utils"

interface ItemProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(function Item(
  { active = false, disabled = false, icon = null, children, className, ...otherProps }: ItemProps,
  ref
) {
  return (
    <div
      className={cn(
        "group/d5612535 flex h-10 cursor-pointer items-center justify-center gap-2 border-b border-solid border-neutral-border px-2.5 py-0.5",
        {
          "border-b-2 border-solid border-slate-950 px-2.5 pt-0.5 pb-px": active,
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {icon ? (
        <SubframeCore.IconWrapper
          className={cn(
            "text-body font-body text-subtext-color group-hover/d5612535:text-default-font",
            {
              "text-neutral-400 group-hover/d5612535:text-neutral-400": disabled,
              "text-slate-950 group-hover/d5612535:text-slate-950": active,
            }
          )}
        >
          {icon}
        </SubframeCore.IconWrapper>
      ) : null}
      {children ? (
        <span
          className={cn(
            "text-body-bold font-body-bold text-subtext-color group-hover/d5612535:text-default-font",
            {
              "text-neutral-400 group-hover/d5612535:text-neutral-400": disabled,
              "text-slate-950 group-hover/d5612535:text-slate-950": active,
            }
          )}
        >
          {children}
        </span>
      ) : null}
    </div>
  )
})

interface TabsRootProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
  className?: string
}

const TabsRoot = React.forwardRef<HTMLDivElement, TabsRootProps>(function TabsRoot(
  { children, className, ...otherProps }: TabsRootProps,
  ref
) {
  return (
    <div className={cn("flex w-full items-end", className)} ref={ref} {...otherProps}>
      {children ? <div className="flex items-start self-stretch">{children}</div> : null}
      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 self-stretch border-b border-solid border-neutral-border" />
    </div>
  )
})

export const Tabs = Object.assign(TabsRoot, {
  Item,
})
