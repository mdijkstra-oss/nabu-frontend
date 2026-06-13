"use client"

import React, { type ReactNode } from "react"
import { CircleDashed } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { cn } from "~/ui/utils"

interface NavItemProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode
  children?: ReactNode
  selected?: boolean
  pointed?: boolean
  badge?: number
  badgeColor?: string
  className?: string
}

const NavItem = React.forwardRef<HTMLDivElement, NavItemProps>(function NavItem(
  {
    icon = <CircleDashed />,
    children,
    selected = false,
    pointed = false,
    badge,
    badgeColor,
    className,
    ...otherProps
  }: NavItemProps,
  ref
) {
  return (
    <div
      className={cn(
        "group/8815d632 flex min-h-[48px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md px-2 pt-3 pb-2 hover:bg-brand-50 active:bg-brand-100",
        {
          "bg-brand-50": selected,
        },
        {
          "bg-brand-600 hover:bg-brand-600": pointed,
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {icon ? (
        <div className="relative">
          <SubframeCore.IconWrapper
            className={cn(
              "text-heading-2 font-heading-2 text-subtext-color group-hover/8815d632:text-default-font group-active/8815d632:text-default-font",
              { "text-default-font": selected },
              {
                "text-white group-hover/8815d632:text-white group-active/8815d632:text-white":
                  pointed,
              }
            )}
          >
            {icon}
          </SubframeCore.IconWrapper>
          {badge != null ? (
            <span
              className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
              style={{ backgroundColor: badgeColor ?? "var(--color-neutral-400)" }}
            >
              {badge > 99 ? "99+" : badge}
            </span>
          ) : null}
        </div>
      ) : null}
      {children ? (
        <span
          className={cn(
            "line-clamp-1 w-full text-caption-bold font-caption-bold text-subtext-color text-center group-hover/8815d632:text-default-font group-active/8815d632:text-default-font",
            { "text-default-font": selected },
            {
              "text-white group-hover/8815d632:text-white group-active/8815d632:text-white":
                pointed,
            }
          )}
        >
          {children}
        </span>
      ) : null}
    </div>
  )
})

interface SidebarRailWithLabelsProps {
  header?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  className?: string
}

const SidebarRailWithLabelsRoot = ({
  header,
  footer,
  children,
  className,
}: SidebarRailWithLabelsProps) => (
  <nav
    className={cn(
      "flex h-full w-24 flex-col items-start border-r border-solid border-neutral-border bg-sidebar",
      className
    )}
  >
    {header ? (
      <div className="flex w-full flex-col items-center justify-center gap-2 px-6 py-6">
        {header}
      </div>
    ) : null}
    {children ? (
      <div className="flex w-full grow shrink-0 basis-0 flex-col items-center gap-1 px-2 py-2 overflow-y-auto overflow-x-hidden">
        {children}
      </div>
    ) : null}
    {footer ? (
      <div className="flex w-full flex-col items-center justify-end gap-1 px-2 py-2">{footer}</div>
    ) : null}
  </nav>
)

export const SidebarRailWithLabels = Object.assign(SidebarRailWithLabelsRoot, {
  NavItem,
})
