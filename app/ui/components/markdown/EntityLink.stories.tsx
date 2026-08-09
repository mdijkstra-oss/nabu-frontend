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
  play: async ({ args, canvas, canvasElement }) => {
    const link = canvas.getByRole("link")
    const base = resolveBackgroundColor(canvasElement, args.colors.background)
    const hover = resolveBackgroundColor(canvasElement, args.colors.backgroundHover)

    // storybook/test's userEvent dispatches synthetic DOM events, which never
    // engage the CSS :hover state — the vitest browser pointer moves the real one.
    const { userEvent: pointer } = await import("vitest/browser")

    // Vite's dev-server error overlay intercepts all real pointer input while
    // shown and reappears on every server error, so it is hidden for the
    // duration of the story in both the tester and orchestrator documents.
    const hideErrorOverlay = (doc: Document) => {
      const style = doc.createElement("style")
      style.textContent = "vite-error-overlay { display: none !important; }"
      doc.head.appendChild(style)
      return style
    }
    const overlaySuppressors = [document, window.frameElement?.ownerDocument]
      .filter((doc): doc is Document => doc != null)
      .map(hideErrorOverlay)

    const pointAndExpect = (move: () => Promise<void>, expected: string) =>
      waitFor(
        async () => {
          await move()
          expect(getComputedStyle(link).backgroundColor).toBe(expected)
        },
        { timeout: 10000 }
      )

    expect(getComputedStyle(link).backgroundColor).toBe(base)

    try {
      await pointAndExpect(() => pointer.hover(link), hover)
      await pointAndExpect(() => pointer.unhover(link), base)
    } finally {
      overlaySuppressors.forEach((style) => style.remove())
    }
  },
}
