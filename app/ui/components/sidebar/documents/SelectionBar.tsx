import { solidBackground, type RadixColor } from "~/ui/theme/radix"

interface SelectionBarProps {
  color: RadixColor
  active?: boolean
  checked?: boolean
}

export const SelectionBar = ({ color, active = false, checked = false }: SelectionBarProps) => {
  if (!active && checked) return null
  return (
    <div
      className={`absolute left-0 top-0 bottom-0 transition-opacity ${
        active ? "w-1 opacity-100" : "w-0.5 opacity-0 group-hover:opacity-100"
      }`}
      style={{ backgroundColor: solidBackground(color) }}
    />
  )
}
