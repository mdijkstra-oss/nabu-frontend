import type { Meta, StoryObj } from "@storybook/react-vite"
import { useLocation, useNavigate, useParams } from "react-router"
import { expect } from "storybook/test"
import { getFiles, updateFileRaw } from "~/lib/files/store"
import { withRouter, withSeededFiles, withSize } from "./decorators"

const KitProbe = () => null

const meta: Meta<typeof KitProbe> = {
  title: "Custom/Kit/Decorators",
  component: KitProbe,
}

export default meta
type Story = StoryObj<typeof KitProbe>

const SizeReporter = () => (
  <div data-testid="size-probe" style={{ width: "100%", height: "100%" }} />
)

export const SizeFrame: Story = {
  render: () => <SizeReporter />,
  decorators: [withSize({ width: "240px", height: "120px" })],
  play: async ({ canvas }) => {
    const probe = canvas.getByTestId("size-probe")
    const rect = probe.getBoundingClientRect()
    expect(rect.width).toBe(240)
    expect(rect.height).toBe(120)
  },
}

const RouterReporter = () => {
  useNavigate()
  const { projectId } = useParams()
  const location = useLocation()
  return (
    <p>
      project:{projectId ?? "none"} path:{location.pathname}
    </p>
  )
}

export const RouterFrame: Story = {
  render: () => <RouterReporter />,
  decorators: [withRouter("/project/p1")],
  play: async ({ canvas }) => {
    await expect(canvas.getByText("project:p1 path:/project/p1")).toBeInTheDocument()
  },
}

const FileNamesReporter = () => <p>files:{Object.keys(getFiles()).sort().join(",")}</p>

export const SeededFilesFirst: Story = {
  render: () => <FileNamesReporter />,
  decorators: [withSeededFiles({ "first.md": "# First" })],
  play: async ({ canvas }) => {
    await expect(canvas.getByText("files:first.md")).toBeInTheDocument()
    expect(getFiles()["first.md"]).toContain("# First")
    expect(getFiles()["second.md"]).toBeUndefined()
  },
}

export const SeededFilesSecond: Story = {
  render: () => <FileNamesReporter />,
  decorators: [withSeededFiles({ "second.md": "# Second" })],
  play: async ({ canvas }) => {
    await expect(canvas.getByText("files:second.md")).toBeInTheDocument()
    expect(getFiles()["second.md"]).toContain("# Second")
    expect(getFiles()["first.md"]).toBeUndefined()
  },
}

export const SeededFilesWriteDuringPlay: Story = {
  render: () => <FileNamesReporter />,
  decorators: [withSeededFiles({ "seeded.md": "# Seeded" })],
  play: async () => {
    updateFileRaw("written-during-play.md", "# Written")
    expect(getFiles()["written-during-play.md"]).toContain("# Written")
    expect(getFiles()["seeded.md"]).toContain("# Seeded")
  },
}

export const StoreRestoredAfterSeededStories: Story = {
  render: () => <FileNamesReporter />,
  play: async () => {
    const files = getFiles()
    expect(files["first.md"]).toBeUndefined()
    expect(files["second.md"]).toBeUndefined()
    expect(files["seeded.md"]).toBeUndefined()
    expect(files["written-during-play.md"]).toBeUndefined()
  },
}

const RadixColorSwatch = () => (
  <div data-testid="radix-swatch" style={{ background: "var(--blue-9)", width: 40, height: 40 }} />
)

export const RadixColorsResolve: Story = {
  render: () => <RadixColorSwatch />,
  play: async ({ canvas }) => {
    const swatch = canvas.getByTestId("radix-swatch")
    const background = getComputedStyle(swatch).backgroundColor
    expect(background).not.toBe("rgba(0, 0, 0, 0)")
    expect(background).not.toBe("")
  },
}
