import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { resolveFixtureThroughSchema } from "~/lib/chart/parsed-fixtures"
import { entity, matrixRenderable, sampleTooltipContext } from "~/lib/chart/test-helpers"
import { parseTemplate } from "~/lib/chart/template"
import type { MatrixCell, MatrixRenderable } from "~/lib/chart/types"
import { mustFind } from "../../../../../.storybook/dom"
import { withSize } from "../../../../../.storybook/decorators"
import type { ChartTooltipContext } from "./ChartTooltip"
import { Heatmap } from "./Heatmap"

const meta: Meta<typeof Heatmap> = {
  title: "Custom/Charts/Heatmap",
  component: Heatmap,
  decorators: [withSize({ width: "640px" })],
}

export default meta
type Story = StoryObj<typeof Heatmap>

export const Skeleton: Story = {
  render: () => (
    <Heatmap
      renderable={resolveFixtureThroughSchema("heatmap", "matrix")}
      tooltipContext={sampleTooltipContext()}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const canvas = within(canvasElement)
      expect(canvas.getByText("interview-3")).toBeInTheDocument()
      expect(canvas.getByText("grief")).toBeInTheDocument()
      expect(canvas.getByText("5")).toBeInTheDocument()
      expect(canvasElement.querySelectorAll(".nabu-chart-heatmap-cell")).toHaveLength(6)
    })
  },
}

const cell = (value: number, extra: Partial<MatrixCell> = {}): MatrixCell => ({
  value,
  _raw: {},
  ...extra,
})

const nestedCells = (
  entries: Record<string, Record<string, MatrixCell>>
): MatrixRenderable["cells"] =>
  new Map(
    Object.entries(entries).map(([x, byY]) => [
      x,
      new Map<string | number, MatrixCell>(Object.entries(byY)),
    ])
  )

const entityContext = (navigate?: (url: string) => void): ChartTooltipContext => ({
  ...sampleTooltipContext({
    "grief.md": entity("grief.md", "Grief", "#4f46e5"),
    "interview-1.md": entity("interview-1.md", "Interview 1", "#0d9488"),
  }),
  files: { "grief.md": "# Grief", "interview-1.md": "# Interview 1" },
  projectId: "p1",
  navigate,
})

const paintedCells = (canvasElement: HTMLElement): HTMLElement[] => [
  ...canvasElement.querySelectorAll<HTMLElement>(
    ".nabu-chart-heatmap-cell:not(.nabu-chart-heatmap-cell-empty)"
  ),
]

const cellShowing = (canvasElement: HTMLElement, text: string): HTMLElement => {
  const match = paintedCells(canvasElement).find((el) => el.textContent === text)
  if (!match) throw new Error(`no cell prints "${text}"`)
  return match
}

export const UniformMatrix: Story = {
  render: () => {
    const cells = nestedCells({
      "interview-1": { grief: cell(4), hope: cell(4) },
      "interview-2": { grief: cell(4), hope: cell(4) },
      "interview-3": { grief: cell(4), hope: cell(4) },
    })
    return (
      <Heatmap
        renderable={matrixRenderable({ cells, min: 4, max: 4 })}
        tooltipContext={sampleTooltipContext()}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const painted = paintedCells(canvasElement)
    expect(painted).toHaveLength(6)
    for (const el of painted) {
      expect(el.style.background).toBe("var(--blue-9)")
      expect(el.style.color).toBe("var(--blue-1)")
    }
    expect(canvasElement.querySelectorAll(".nabu-chart-heatmap-cell-empty")).toHaveLength(0)
  },
}

export const LinearRamp: Story = {
  render: () => (
    <Heatmap
      renderable={matrixRenderable({
        xKeys: ["low", "mid", "high"],
        yKeys: ["delta"],
        cells: nestedCells({
          low: { delta: cell(-5) },
          mid: { delta: cell(0) },
          high: { delta: cell(5) },
        }),
        min: -5,
        max: 5,
      })}
      tooltipContext={sampleTooltipContext()}
    />
  ),
  play: async ({ canvasElement }) => {
    const shadeByValue: [string, number][] = [
      ["-5", 3],
      ["0", 6],
      ["5", 9],
    ]
    for (const [text, shade] of shadeByValue) {
      const el = cellShowing(canvasElement, text)
      expect(el.style.background).toBe(`var(--blue-${shade})`)
      expect(el.style.color).toBe(`var(--blue-${shade <= 7 ? 12 : 1})`)
    }
  },
}

export const ZeroVersusAbsent: Story = {
  render: () => (
    <Heatmap
      renderable={matrixRenderable({
        xKeys: ["interview-1", "interview-2", "interview-3"],
        yKeys: ["grief"],
        cells: nestedCells({
          "interview-1": { grief: cell(0) },
          "interview-3": { grief: cell(5) },
        }),
        min: 0,
        max: 5,
      })}
      tooltipContext={sampleTooltipContext()}
    />
  ),
  play: async ({ canvasElement }) => {
    const zero = cellShowing(canvasElement, "0")
    expect(zero.style.background).toBe("var(--blue-3)")

    const absent = mustFind(canvasElement, ".nabu-chart-heatmap-cell-empty")
    expect(absent.style.background).toBe("")
    expect(absent.textContent).toBe("")
  },
}

const navigateSpy = fn()

export const EntityRowLabels: Story = {
  render: () => (
    <Heatmap
      renderable={matrixRenderable({
        xKeys: ["interview-1"],
        yKeys: ["grief.md"],
        cells: nestedCells({ "interview-1": { "grief.md": cell(3) } }),
        min: 3,
        max: 3,
      })}
      tooltipContext={entityContext(navigateSpy)}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pill = await canvas.findByRole("link", { name: "Grief" })
    expect(pill).toHaveAttribute("href", "/project/p1/file/grief.md")
    await userEvent.click(pill)
    expect(navigateSpy).toHaveBeenCalledWith("/project/p1/file/grief.md")
  },
}

export const PlainAxisLabels: Story = {
  render: () => <Heatmap renderable={matrixRenderable()} tooltipContext={sampleTooltipContext()} />,
  play: async ({ canvasElement }) => {
    const label = within(canvasElement).getByText("interview-1")
    expect(label.tagName).toBe("SPAN")
    expect(label.closest("a")).toBeNull()
    expect(canvasElement.querySelectorAll(".nabu-chart-heatmap-col-label a")).toHaveLength(0)
  },
}

const datumClickSpy = fn()

export const DatumClick: Story = {
  render: () => (
    <Heatmap
      renderable={matrixRenderable({
        xKeys: ["interview-1"],
        yKeys: ["grief"],
        cells: nestedCells({
          "interview-1": { grief: cell(3, { _entityUrl: "/project/p1/file/interview-1.md" }) },
        }),
        min: 3,
        max: 3,
      })}
      tooltipContext={sampleTooltipContext()}
      onDatumClick={datumClickSpy}
    />
  ),
  play: async ({ canvasElement }) => {
    const target = cellShowing(canvasElement, "3")
    expect(getComputedStyle(target).cursor).toBe("pointer")
    await userEvent.click(target)
    expect(datumClickSpy).toHaveBeenCalledWith("/project/p1/file/interview-1.md")
  },
}

export const NoPointerWithoutUrlOrHandler: Story = {
  render: function NoPointerStory() {
    return (
      <Heatmap
        renderable={matrixRenderable({
          xKeys: ["interview-1", "interview-2"],
          yKeys: ["grief"],
          cells: nestedCells({
            "interview-1": { grief: cell(3, { _entityUrl: "/somewhere" }) },
            "interview-2": { grief: cell(4) },
          }),
          min: 3,
          max: 4,
        })}
        tooltipContext={sampleTooltipContext()}
      />
    )
  },
  play: async ({ canvasElement }) => {
    for (const text of ["3", "4"]) {
      expect(getComputedStyle(cellShowing(canvasElement, text)).cursor).not.toBe("pointer")
    }
  },
}

export const NoPointerWithoutEntityUrl: Story = {
  render: function NoPointerWithoutUrlStory() {
    return (
      <Heatmap
        renderable={matrixRenderable({
          xKeys: ["interview-1"],
          yKeys: ["grief"],
          cells: nestedCells({ "interview-1": { grief: cell(3) } }),
          min: 3,
          max: 3,
        })}
        tooltipContext={sampleTooltipContext()}
        onDatumClick={fn()}
      />
    )
  },
  play: async ({ canvasElement }) => {
    expect(getComputedStyle(cellShowing(canvasElement, "3")).cursor).not.toBe("pointer")
  },
}

export const TemplateTooltip: Story = {
  render: () => (
    <Heatmap
      renderable={matrixRenderable({
        xKeys: ["interview-1"],
        yKeys: ["grief.md"],
        cells: nestedCells({
          "interview-1": {
            "grief.md": cell(3, {
              _raw: { code: "grief.md", document: "interview-1", n: 3 },
              _tooltipNodes: parseTemplate("{code} appears {n} times"),
            }),
          },
        }),
        min: 3,
        max: 3,
      })}
      tooltipContext={entityContext()}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.hover(cellShowing(canvasElement, "3"))
    await waitFor(() => {
      const tooltip = mustFind(canvasElement, ".nabu-chart-heatmap-tooltip")
      expect(tooltip.textContent).toBe("Grief appears 3 times")
      const entityLink = within(tooltip).getByText("Grief")
      expect(entityLink.closest("a")).not.toBeNull()
    })
  },
}

export const FallbackTooltip: Story = {
  render: () => (
    <Heatmap
      renderable={matrixRenderable({
        xKeys: ["interview-1.md"],
        yKeys: ["grief.md"],
        cells: nestedCells({ "interview-1.md": { "grief.md": cell(5) } }),
        min: 5,
        max: 5,
        valueFormat: ".1f",
      })}
      tooltipContext={entityContext()}
    />
  ),
  play: async ({ canvasElement }) => {
    const target = cellShowing(canvasElement, "5.0")
    await userEvent.hover(target)
    await waitFor(() => {
      const tooltip = mustFind(canvasElement, ".nabu-chart-heatmap-tooltip")
      expect(tooltip.querySelector("strong")?.textContent).toBe("Interview 1")
      const lines = [...tooltip.querySelectorAll("li")].map((li) => li.textContent)
      expect(lines).toEqual(["Grief: 5.0"])
    })
  },
}

const largeMatrixRenderable = (): MatrixRenderable => {
  const xKeys = Array.from({ length: 30 }, (_, i) => `doc-${i + 1}`)
  const yKeys = Array.from({ length: 20 }, (_, i) => `code-${i + 1}`)
  const cells = new Map<string | number, Map<string | number, MatrixCell>>(
    xKeys.map((x, i) => [
      x,
      new Map<string | number, MatrixCell>(yKeys.map((y, j) => [y, cell((i + j) % 9)])),
    ])
  )
  return matrixRenderable({ xKeys, yKeys, cells, min: 0, max: 8 })
}

export const LargeMatrixPans: Story = {
  render: () => (
    <Heatmap renderable={largeMatrixRenderable()} tooltipContext={sampleTooltipContext()} />
  ),
  play: async ({ canvasElement }) => {
    const root = mustFind(canvasElement, ".nabu-chart-heatmap")
    expect(root.getBoundingClientRect().width).toBeLessThanOrEqual(640)

    const scroll = mustFind(canvasElement, ".nabu-chart-heatmap-scroll")
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)

    scroll.scrollLeft = 300
    await waitFor(() => {
      expect(scroll.scrollLeft).toBeGreaterThan(0)
      const label = mustFind(canvasElement, ".nabu-chart-heatmap-row-label")
      expect(getComputedStyle(label).position).toBe("sticky")
      const offset = label.getBoundingClientRect().left - scroll.getBoundingClientRect().left
      expect(Math.abs(offset)).toBeLessThan(2)
    })
  },
}

export const ExplicitHeight: Story = {
  render: () => (
    <Heatmap renderable={matrixRenderable()} tooltipContext={sampleTooltipContext()} height={220} />
  ),
  play: async ({ canvasElement }) => {
    const root = mustFind(canvasElement, ".nabu-chart-heatmap")
    expect(root.getBoundingClientRect().height).toBe(220)
  },
}
