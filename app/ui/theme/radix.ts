export { type RadixColor } from "./colors"

export const radixVar = (color: string, shade: number): string => `var(--${color}-${shade})`

export const subtleBackground = (color: string): string => radixVar(color, 2)
export const elementBackground = (color: string): string => radixVar(color, 3)
export const hoveredElementBackground = (color: string): string => radixVar(color, 4)
export const subtleBorder = (color: string): string => radixVar(color, 6)
export const elementBorder = (color: string): string => radixVar(color, 7)
export const hoveredElementBorder = (color: string): string => radixVar(color, 8)
export const solidBackground = (color: string): string => radixVar(color, 9)
export const lowContrastText = (color: string): string => radixVar(color, 11)
export const highContrastText = (color: string): string => radixVar(color, 12)

// Rasterizing through an sRGB canvas normalizes any computed color — including
// the color(display-p3 …) values wide-gamut displays produce — where string
// parsing cannot.
const toSrgbHex = (computed: string): string => {
  const context = document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  })
  if (!context) return computed
  context.fillStyle = computed
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")
}

export const resolveCssColorHex = (cssColor: string): string => {
  const el = document.createElement("span")
  el.style.display = "none"
  el.style.color = cssColor
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  document.body.removeChild(el)
  return toSrgbHex(computed)
}

export const resolveRadixHex = (color: string, shade: number): string =>
  resolveCssColorHex(radixVar(color, shade))
