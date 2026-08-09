import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowRight, Plus } from "lucide-react"
import { renderVariantMatrix } from "../../../.storybook/matrix"
import { Button } from "./Button"

export const buttonVariants = [
  "brand-primary",
  "brand-secondary",
  "brand-tertiary",
  "neutral-primary",
  "neutral-secondary",
  "neutral-tertiary",
  "destructive-primary",
  "destructive-secondary",
  "destructive-tertiary",
  "inverse",
] as const

export const buttonSizes = ["large", "medium", "small"] as const

const meta: Meta<typeof Button> = {
  title: "Custom/Primitives/Button",
  component: Button,
}

export default meta
type Story = StoryObj<typeof Button>

export const Matrix: Story = {
  render: () =>
    renderVariantMatrix(Button, {
      variants: buttonVariants,
      sizes: buttonSizes,
      propsFor: (variant, size) => ({ variant, size, children: variant }),
      cellClassName: (variant) => (variant === "inverse" ? "rounded-md bg-slate-950 p-1" : "p-1"),
    }),
}

export const Loading: Story = {
  args: { loading: true, children: "Saving" },
}

export const Disabled: Story = {
  args: { disabled: true, children: "Disabled" },
}

export const WithIcons: Story = {
  args: { icon: <Plus />, iconRight: <ArrowRight />, children: "Add item" },
}
