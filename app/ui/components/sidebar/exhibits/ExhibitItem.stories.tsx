import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import type { ChartSubtype } from "~/domain/exhibits/types"
import { withSize } from "../../../../../.storybook/decorators"
import { CHART_SUBTYPES } from "./registry"
import { ExhibitItem } from "./ExhibitItem"

const meta: Meta<typeof ExhibitItem> = {
  title: "Custom/Sidebar/Exhibits/ExhibitItem",
  component: ExhibitItem,
  parameters: {
    layout: "padded",
  },
  decorators: [withSize({ width: "280px" })],
}

export default meta
type Story = StoryObj<typeof ExhibitItem>

export const Subtypes: Story = {
  render: () => (
    <div className="flex flex-col">
      {(Object.keys(CHART_SUBTYPES) as ChartSubtype[]).map((subtype) => {
        const config = CHART_SUBTYPES[subtype]
        return (
          <ExhibitItem
            key={subtype}
            title={config.display}
            documentTitle={`A ${subtype} exhibit`}
            icon={config.icon}
            color={config.color}
          />
        )
      })}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const config of Object.values(CHART_SUBTYPES)) {
      expect(canvas.getByText(config.display)).toBeInTheDocument()
    }
    expect(canvasElement.querySelectorAll("svg")).toHaveLength(Object.keys(CHART_SUBTYPES).length)
  },
}

export const Selected: Story = {
  args: {
    title: "Deforestation by Region",
    documentTitle: "Habitat Destruction Framework",
    icon: CHART_SUBTYPES.bar.icon,
    color: CHART_SUBTYPES.bar.color,
    selected: true,
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector(".w-1")).not.toBeNull()
  },
}

export const LongTitle: Story = {
  args: {
    title:
      "A remarkably long exhibit title that would spill onto several lines were it not clamped",
    documentTitle: "An equally long source document title that must also stay on a single line",
    icon: CHART_SUBTYPES.line.icon,
    color: CHART_SUBTYPES.line.color,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(args.title).className).toContain("line-clamp-1")
    expect(canvas.getByText(args.documentTitle).className).toContain("line-clamp-1")
  },
}
