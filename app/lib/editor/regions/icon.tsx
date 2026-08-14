import type { ComponentType } from "react"
import { useWidgetViewContext } from "@prosemirror-adapter/react"
import { Search } from "lucide-react"
import { resolveIcon } from "~/ui/theme/icon-map"
import { lowContrastText, radixVar } from "~/ui/theme/radix"

const DEFAULT_COLOUR = "gray"

const Glyph = ({
  icon: Icon,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
}) => <Icon className="inline-block h-[0.75em] w-[0.75em] align-[-0.05em]" strokeWidth={2.75} />

export const RegionIcon = () => {
  const { spec } = useWidgetViewContext()
  const colour = (spec?.colour as string | undefined) ?? DEFAULT_COLOUR
  const hovered = spec?.hovered === true
  const kind = (spec?.kind as string | undefined) ?? ""
  const label = (spec?.label as string | undefined) ?? ""
  const asSearchButton = spec?.searchable === true && hovered
  return (
    <span
      aria-hidden={asSearchButton ? undefined : "true"}
      role={asSearchButton ? "button" : undefined}
      aria-label={asSearchButton ? `Search ${kind}: ${label}` : undefined}
      title={asSearchButton ? `Search ${kind}: ${label}` : undefined}
      contentEditable={false}
      data-region-icon={kind}
      data-region-index={spec?.index !== undefined ? String(spec.index) : undefined}
      data-region-search={asSearchButton ? "" : undefined}
      className={`pr-[1px]${asSearchButton ? " cursor-pointer" : ""}`}
      style={{
        color: lowContrastText(colour),
        marginLeft: spec?.atBlockStart === true ? undefined : "2px",
        ...(hovered ? { background: radixVar(colour, 5) } : {}),
      }}
    >
      <Glyph
        icon={asSearchButton ? Search : resolveIcon((spec?.icon as string | undefined) ?? "")}
      />
    </span>
  )
}
