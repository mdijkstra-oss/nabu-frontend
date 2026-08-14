export const mustFind = (root: ParentNode, selector: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(selector)
  if (!el) throw new Error(`no element matches "${selector}"`)
  return el
}
