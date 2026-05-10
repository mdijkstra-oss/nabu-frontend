"use client"

import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type ChangeEvent,
} from "react"
import * as SubframeCore from "@subframe/core"
import { cn } from "~/ui/utils"

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "placeholder"> {
  placeholder?: ReactNode
  value?: string
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  className?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { placeholder, className, ...otherProps }: InputProps,
  ref
) {
  return (
    <input
      className={cn(
        "h-full w-full border-none bg-transparent text-body font-body text-default-font outline-none placeholder:text-neutral-400",
        className
      )}
      placeholder={placeholder as string}
      ref={ref}
      {...otherProps}
    />
  )
})

interface TextFieldRootProps extends LabelHTMLAttributes<HTMLLabelElement> {
  disabled?: boolean
  error?: boolean
  variant?: "outline" | "filled"
  label?: ReactNode
  helpText?: ReactNode
  icon?: ReactNode
  iconRight?: ReactNode
  children?: ReactNode
  className?: string
}

const TextFieldRoot = forwardRef<HTMLLabelElement, TextFieldRootProps>(function TextFieldRoot(
  {
    disabled = false,
    error = false,
    variant = "outline",
    label,
    helpText,
    icon = null,
    iconRight = null,
    children,
    className,
    ...otherProps
  }: TextFieldRootProps,
  ref
) {
  return (
    <label
      className={cn("group/be48ca43 flex flex-col items-start gap-1", className)}
      ref={ref}
      {...otherProps}
    >
      {label ? (
        <span className="text-caption-bold font-caption-bold text-default-font">{label}</span>
      ) : null}
      <div
        className={cn(
          "flex h-8 w-full flex-none items-center gap-1 rounded-md border border-solid border-neutral-border bg-default-background px-2 group-focus-within/be48ca43:border group-focus-within/be48ca43:border-solid group-focus-within/be48ca43:border-brand-primary",
          {
            "border border-solid border-neutral-100 bg-neutral-100 group-hover/be48ca43:border group-hover/be48ca43:border-solid group-hover/be48ca43:border-neutral-border group-focus-within/be48ca43:border-brand-primary group-focus-within/be48ca43:bg-default-background":
              variant === "filled",
            "border border-solid border-error-600": error,
            "border border-solid border-neutral-200 bg-neutral-200": disabled,
          }
        )}
      >
        {icon ? (
          <SubframeCore.IconWrapper className="text-body font-body text-subtext-color">
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
        {children ? (
          <div className="flex grow shrink-0 basis-0 flex-col items-start self-stretch px-1">
            {children}
          </div>
        ) : null}
        {iconRight ? (
          <SubframeCore.IconWrapper
            className={cn("text-body font-body text-subtext-color", { "text-error-500": error })}
          >
            {iconRight}
          </SubframeCore.IconWrapper>
        ) : null}
      </div>
      {helpText ? (
        <span
          className={cn("text-caption font-caption text-subtext-color", {
            "text-error-700": error,
          })}
        >
          {helpText}
        </span>
      ) : null}
    </label>
  )
})

export const TextField = Object.assign(TextFieldRoot, {
  Input,
})
