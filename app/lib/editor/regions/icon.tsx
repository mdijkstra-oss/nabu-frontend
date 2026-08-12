import type { ComponentType } from "react"
import { useWidgetViewContext } from "@prosemirror-adapter/react"
import { resolveIcon } from "~/ui/theme/icon-map"
import { elementBackground, lowContrastText } from "~/ui/theme/radix"

const DEFAULT_COLOUR = "gray"

const Glyph = ({ icon: Icon }: { icon: ComponentType<{ className?: string }> }) => (
  <Icon className="h-3 w-3" />
)

export const RegionIcon = () => {
  const { spec } = useWidgetViewContext()
  const colour = (spec?.colour as string | undefined) ?? DEFAULT_COLOUR
  return (
    <span
      aria-hidden="true"
      contentEditable={false}
      data-region-icon={(spec?.kind as string | undefined) ?? ""}
      className="inline-flex items-center rounded-l-[3px] py-[1px] pl-[2px] align-[-2px]"
      style={{ background: elementBackground(colour), color: lowContrastText(colour) }}
    >
      <Glyph icon={resolveIcon((spec?.icon as string | undefined) ?? "")} />
    </span>
  )
}
