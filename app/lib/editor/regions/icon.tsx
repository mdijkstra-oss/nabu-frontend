import type { ComponentType } from "react"
import { useWidgetViewContext } from "@prosemirror-adapter/react"
import { resolveIcon } from "~/ui/theme/icon-map"
import { elementBackground, hoveredElementBorder, lowContrastText } from "~/ui/theme/radix"

const DEFAULT_COLOUR = "gray"

const Glyph = ({ icon: Icon }: { icon: ComponentType<{ className?: string }> }) => (
  <Icon className="inline-block h-[0.75em] w-[0.75em]" />
)

export const RegionIcon = () => {
  const { spec } = useWidgetViewContext()
  const colour = (spec?.colour as string | undefined) ?? DEFAULT_COLOUR
  const muted = spec?.muted === true
  return (
    <span
      aria-hidden="true"
      contentEditable={false}
      data-region-icon={(spec?.kind as string | undefined) ?? ""}
      className="rounded-l-[3px] py-[1px] pl-[2px]"
      style={{
        color: lowContrastText(colour),
        border: `1px solid ${muted ? "transparent" : hoveredElementBorder(colour)}`,
        borderRight: "none",
        marginLeft: spec?.atBlockStart === true ? undefined : "2px",
        ...(muted
          ? {}
          : { background: elementBackground(colour), position: "relative", zIndex: 1 }),
      }}
    >
      <Glyph icon={resolveIcon((spec?.icon as string | undefined) ?? "")} />
    </span>
  )
}
