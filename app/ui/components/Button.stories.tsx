import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowRight, Plus } from "lucide-react"
import { Button } from "./Button"

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

const meta: Meta<typeof Button> = {
  title: "Custom/Primitives/Button",
  component: Button,
}

export default meta
type Story = StoryObj<typeof Button>

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
            <Button variant={variant} size={size}>
              {variant}
            </Button>
          </div>
        ))
      )}
    </div>
  ),
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
