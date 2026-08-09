import type { Meta, StoryObj } from "@storybook/react-vite"
import { renderVariantMatrix } from "../../../.storybook/matrix"
import { Avatar } from "./Avatar"

export const avatarVariants = ["brand", "neutral", "error", "success", "warning"] as const
export const avatarSizes = ["x-large", "large", "medium", "small", "x-small"] as const

const pixelImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const meta: Meta<typeof Avatar> = {
  title: "Custom/Primitives/Avatar",
  component: Avatar,
}

export default meta
type Story = StoryObj<typeof Avatar>

export const Matrix: Story = {
  render: () =>
    renderVariantMatrix(Avatar, {
      variants: avatarVariants,
      sizes: avatarSizes,
      propsFor: (variant, size) => ({ variant, size, children: "MD" }),
      gridClassName: "grid w-fit items-center justify-items-center gap-2",
    }),
}

export const WithImage: Story = {
  args: { image: pixelImage },
}

export const Square: Story = {
  args: { square: true, children: "MD" },
}
