"use client"

import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type MouseEvent } from "react"
import { Plus } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { cn } from "~/ui/utils"

interface IconButtonRootProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  disabled?: boolean
  variant?:
    | "brand-primary"
    | "brand-secondary"
    | "brand-tertiary"
    | "neutral-primary"
    | "neutral-secondary"
    | "neutral-tertiary"
    | "destructive-primary"
    | "destructive-secondary"
    | "destructive-tertiary"
    | "inverse"
  size?: "large" | "medium" | "small"
  icon?: ReactNode
  loading?: boolean
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  className?: string
}

const IconButtonRoot = forwardRef<HTMLButtonElement, IconButtonRootProps>(function IconButtonRoot(
  {
    disabled = false,
    variant = "neutral-tertiary",
    size = "medium",
    icon = <Plus />,
    loading = false,
    className,
    type = "button",
    ...otherProps
  }: IconButtonRootProps,
  ref
) {
  return (
    <button
      className={cn(
        "group/af9405b1 flex h-8 w-8 cursor-pointer items-center justify-center gap-2 rounded-md border-none bg-transparent text-left hover:bg-neutral-100 active:bg-neutral-50 disabled:cursor-default disabled:bg-neutral-100 active:disabled:cursor-default active:disabled:bg-neutral-100",
        {
          "h-6 w-6": size === "small",
          "h-10 w-10": size === "large",
          "hover:bg-[#ffffff29] active:bg-[#ffffff3d]": variant === "inverse",
          "hover:bg-error-50 active:bg-error-100": variant === "destructive-tertiary",
          "bg-error-50 hover:bg-error-100 active:bg-error-50": variant === "destructive-secondary",
          "bg-error-600 hover:bg-error-500 active:bg-error-600": variant === "destructive-primary",
          "border border-solid border-neutral-border bg-white active:bg-white":
            variant === "neutral-secondary",
          "bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-100":
            variant === "neutral-primary",
          "hover:bg-brand-50 active:bg-brand-100": variant === "brand-tertiary",
          "bg-brand-50 hover:bg-brand-100 active:bg-brand-50": variant === "brand-secondary",
          "bg-slate-950 hover:bg-slate-900 active:bg-slate-950": variant === "brand-primary",
        },
        className
      )}
      ref={ref}
      type={type}
      disabled={disabled}
      {...otherProps}
    >
      {icon ? (
        <SubframeCore.IconWrapper
          className={cn(
            "text-heading-3 font-heading-3 text-neutral-700 group-disabled/af9405b1:text-neutral-400",
            {
              hidden: loading,
              "text-body font-body": size === "small",
              "text-white":
                variant === "inverse" ||
                variant === "destructive-primary" ||
                variant === "brand-primary",
              "text-error-700":
                variant === "destructive-tertiary" || variant === "destructive-secondary",
              "text-brand-700": variant === "brand-tertiary" || variant === "brand-secondary",
            }
          )}
        >
          {icon}
        </SubframeCore.IconWrapper>
      ) : null}
      <SubframeCore.Loader
        className={cn(
          "hidden text-caption font-caption text-neutral-700 group-disabled/af9405b1:text-neutral-400",
          {
            "inline-block": loading,
            "text-white":
              variant === "inverse" ||
              variant === "destructive-primary" ||
              variant === "brand-primary",
            "text-error-700":
              variant === "destructive-tertiary" || variant === "destructive-secondary",
            "text-brand-700": variant === "brand-tertiary" || variant === "brand-secondary",
          }
        )}
      />
    </button>
  )
})

export const IconButton = IconButtonRoot
