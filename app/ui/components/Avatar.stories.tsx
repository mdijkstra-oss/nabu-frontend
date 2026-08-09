import type { Meta, StoryObj } from "@storybook/react-vite"
import { Avatar } from "./Avatar"

const variants = ["brand", "neutral", "error", "success", "warning"] as const
const sizes = ["x-large", "large", "medium", "small", "x-small"] as const

const pixelImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const meta: Meta<typeof Avatar> = {
  title: "Custom/Primitives/Avatar",
  component: Avatar,
}

export default meta
type Story = StoryObj<typeof Avatar>

export const Matrix: Story = {
  render: () => (
    <div
      className="grid w-fit items-center justify-items-center gap-2"
      style={{ gridTemplateColumns: `repeat(${sizes.length}, auto)` }}
    >
      {variants.flatMap((variant) =>
        sizes.map((size) => (
          <Avatar key={`${variant}-${size}`} variant={variant} size={size}>
            MD
          </Avatar>
        ))
      )}
    </div>
  ),
}

export const WithImage: Story = {
  args: { image: pixelImage },
}

export const Square: Story = {
  args: { square: true, children: "MD" },
}
