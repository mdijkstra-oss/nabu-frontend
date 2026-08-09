import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bot } from "lucide-react"
import { renderVariantMatrix } from "../../../.storybook/matrix"
import { avatarSizes, avatarVariants } from "./Avatar.stories"
import { IconWithBackground } from "./IconWithBackground"

const meta: Meta<typeof IconWithBackground> = {
  title: "Custom/Primitives/IconWithBackground",
  component: IconWithBackground,
}

export default meta
type Story = StoryObj<typeof IconWithBackground>

export const Matrix: Story = {
  render: () =>
    renderVariantMatrix(IconWithBackground, {
      variants: avatarVariants,
      sizes: avatarSizes,
      propsFor: (variant, size) => ({ variant, size, icon: <Bot /> }),
      gridClassName: "grid w-fit items-center justify-items-center gap-2",
    }),
}
