import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowRight, Link as LinkIcon } from "lucide-react"
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
            <LinkButton variant={variant} size={size}>
              {variant}
            </LinkButton>
          </div>
        ))
      )}
    </div>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, children: "Disabled link" },
}

export const WithIcons: Story = {
  args: { icon: <LinkIcon />, iconRight: <ArrowRight />, children: "Open reference" },
}
