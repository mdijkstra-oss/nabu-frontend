import type { Meta, StoryObj } from "@storybook/react-vite"
import { Star } from "lucide-react"
import { renderVariantMatrix } from "../../../.storybook/matrix"
import { buttonSizes, buttonVariants } from "./Button.stories"
import { IconButton } from "./IconButton"

const meta: Meta<typeof IconButton> = {
  title: "Custom/Primitives/IconButton",
  component: IconButton,
}

export default meta
type Story = StoryObj<typeof IconButton>

export const Matrix: Story = {
  render: () =>
    renderVariantMatrix(IconButton, {
      variants: buttonVariants,
      sizes: buttonSizes,
      propsFor: (variant, size) => ({ variant, size, icon: <Star /> }),
      cellClassName: (variant) => (variant === "inverse" ? "rounded-md bg-slate-950 p-1" : "p-1"),
    }),
}

export const Loading: Story = {
  args: { loading: true, icon: <Star /> },
}

export const Disabled: Story = {
  args: { disabled: true, icon: <Star /> },
}
