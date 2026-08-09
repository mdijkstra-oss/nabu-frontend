import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bot } from "lucide-react"
import { IconWithBackground } from "./IconWithBackground"

const variants = ["brand", "neutral", "error", "success", "warning"] as const
const sizes = ["x-large", "large", "medium", "small", "x-small"] as const

const meta: Meta<typeof IconWithBackground> = {
  title: "Custom/Primitives/IconWithBackground",
  component: IconWithBackground,
}

export default meta
type Story = StoryObj<typeof IconWithBackground>

export const Matrix: Story = {
  render: () => (
    <div
      className="grid w-fit items-center justify-items-center gap-2"
      style={{ gridTemplateColumns: `repeat(${sizes.length}, auto)` }}
    >
      {variants.flatMap((variant) =>
        sizes.map((size) => (
          <IconWithBackground
            key={`${variant}-${size}`}
            variant={variant}
            size={size}
            icon={<Bot />}
          />
        ))
      )}
    </div>
  ),
}
