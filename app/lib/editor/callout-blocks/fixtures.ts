import type { CalloutBlock } from "~/domain/data-blocks/callout/schema"

export const callout = (
  color: string,
  { collapsed = false }: { collapsed?: boolean } = {}
): CalloutBlock => ({
  id: `code-trust-${color}`,
  type: "codebook-code",
  title: "Trust",
  content: "Signals of **mutual reliance** between participants.",
  color,
  collapsed,
})
