import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowRight, FileText } from "lucide-react"
import { Badge } from "./Badge"

const variants = ["brand", "neutral", "error", "warning", "success"] as const

const meta: Meta<typeof Badge> = {
  title: "Custom/Primitives/Badge",
  component: Badge,
}

export default meta
type Story = StoryObj<typeof Badge>

export const AllVariants: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      {variants.map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
}

export const WithIcons: Story = {
  args: { icon: <FileText />, iconRight: <ArrowRight />, children: "Document" },
}
