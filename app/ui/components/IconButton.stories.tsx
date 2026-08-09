import type { Meta, StoryObj } from "@storybook/react-vite"
import { Star } from "lucide-react"
import { IconButton } from "./IconButton"

const variants = [
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

const sizes = ["large", "medium", "small"] as const

const meta: Meta<typeof IconButton> = {
  title: "Custom/Primitives/IconButton",
  component: IconButton,
}

export default meta
type Story = StoryObj<typeof IconButton>

export const Matrix: Story = {
  render: () => (
    <div
      className="grid w-fit items-center gap-2"
      style={{ gridTemplateColumns: `repeat(${sizes.length}, auto)` }}
    >
      {variants.flatMap((variant) =>
        sizes.map((size) => (
          <div
            key={`${variant}-${size}`}
            className={variant === "inverse" ? "rounded-md bg-slate-950 p-1" : "p-1"}
          >
            <IconButton variant={variant} size={size} icon={<Star />} />
          </div>
        ))
      )}
    </div>
  ),
}

export const Loading: Story = {
  args: { loading: true, icon: <Star /> },
}

export const Disabled: Story = {
  args: { disabled: true, icon: <Star /> },
}
