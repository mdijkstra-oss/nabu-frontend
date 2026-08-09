import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowRight, Link as LinkIcon } from "lucide-react"
import { renderVariantMatrix } from "../../../.storybook/matrix"
import { LinkButton } from "./LinkButton"

const variants = ["brand", "neutral", "inverse"] as const
const sizes = ["large", "medium", "small"] as const

const meta: Meta<typeof LinkButton> = {
  title: "Custom/Primitives/LinkButton",
  component: LinkButton,
}

export default meta
type Story = StoryObj<typeof LinkButton>

export const Matrix: Story = {
  render: () =>
    renderVariantMatrix(LinkButton, {
      variants,
      sizes,
      propsFor: (variant, size) => ({ variant, size, children: variant }),
      cellClassName: (variant) => (variant === "inverse" ? "rounded-md bg-slate-950 p-1" : "p-1"),
    }),
}

export const Disabled: Story = {
  args: { disabled: true, children: "Disabled link" },
}

export const WithIcons: Story = {
  args: { icon: <LinkIcon />, iconRight: <ArrowRight />, children: "Open reference" },
}
