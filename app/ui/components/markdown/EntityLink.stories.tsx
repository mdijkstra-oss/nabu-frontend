import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import { FileText, MapPin } from "lucide-react"
import { resolveEntityLink, type ResolvedColors } from "~/lib/markdown/resolve"
import {
  elementBackground,
  hoveredElementBackground,
  lowContrastText,
  solidBackground,
} from "~/ui/theme/radix"
import { forceHover } from "../../../../.storybook/hover"
import { EntityLink } from "./EntityLink"

const files = { "field-notes.md": "# Field notes" }
const icons = { file: FileText, spotlight: MapPin }

const requireLink = (url: string) => {
  const link = resolveEntityLink(url, files, "p1", icons)
  if (!link) throw new Error(`unresolvable entity link: ${url}`)
  return link
}

const fileLink = requireLink("file://field-notes.md")
const spotlightLink = requireLink("file://field-notes.md/coping+strategies")

const grassColors: ResolvedColors = {
  text: lowContrastText("grass"),
  icon: solidBackground("grass"),
  background: elementBackground("grass"),
  backgroundHover: hoveredElementBackground("grass"),
}

const resolveBackgroundColor = (host: HTMLElement, value: string): string => {
  const probe = document.createElement("div")
  probe.style.background = value
  host.appendChild(probe)
  const color = getComputedStyle(probe).backgroundColor
  probe.remove()
  return color
}

const meta: Meta<typeof EntityLink> = {
  title: "Custom/Markdown/EntityLink",
  component: EntityLink,
}

export default meta
type Story = StoryObj<typeof EntityLink>

export const FileLink: Story = {
  args: {
    href: fileLink.url,
    colors: fileLink.colors,
    icon: fileLink.icon,
    children: fileLink.label,
    onClick: (e) => e.preventDefault(),
  },
}

export const SpotlightLink: Story = {
  args: {
    href: spotlightLink.url,
    colors: spotlightLink.colors,
    icon: spotlightLink.icon,
    children: spotlightLink.label,
    onClick: (e) => e.preventDefault(),
  },
}

export const RadixPaletteLink: Story = {
  args: {
    href: fileLink.url,
    colors: grassColors,
    icon: FileText,
    children: "coping strategies",
    onClick: (e) => e.preventDefault(),
  },
}

export const HoverSwapsBackground: Story = {
  args: {
    href: fileLink.url,
    colors: fileLink.colors,
    icon: fileLink.icon,
    children: fileLink.label,
    onClick: (e) => e.preventDefault(),
  },
  render: (args) => (
    <div data-testid="hover-host">
      <EntityLink {...args} />
    </div>
  ),
  play: async ({ args, canvas, canvasElement }) => {
    const link = canvas.getByRole("link")
    const base = resolveBackgroundColor(canvasElement, args.colors.background)
    const hover = resolveBackgroundColor(canvasElement, args.colors.backgroundHover)
    const selector = '[data-testid="hover-host"] a'

    expect(getComputedStyle(link).backgroundColor).toBe(base)

    const hovered = await forceHover(selector)
    if (!hovered) return
    await waitFor(() => expect(getComputedStyle(link).backgroundColor).toBe(hover))

    await hovered.release()
    await waitFor(() => expect(getComputedStyle(link).backgroundColor).toBe(base))
  },
}
