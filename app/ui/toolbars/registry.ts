import type { ToolbarConfig, ToolbarFactory } from "./types"
import { codeRefinementToolbar } from "./code-refinement"

const factories = new Map<string, ToolbarFactory>([["code-refinement", codeRefinementToolbar]])

export function buildToolbar(
  name: string,
  meta: Record<string, string>
): ToolbarConfig | undefined {
  const factory = factories.get(name)
  if (!factory) return undefined
  return factory(meta)
}
