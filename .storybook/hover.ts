import { cdp } from "vitest/browser"

export interface ForcedHover {
  release: () => Promise<void>
}

// storybook/test's userEvent dispatches synthetic DOM events, which never engage
// the CSS :hover state, and real pointer input does not reliably reach the
// scale-transformed tester iframe — so the pseudo state is forced through CDP's
// CSS.forcePseudoState. Outside the vitest runner (the Storybook viewer) cdp is
// a null stub and this helper reports null so stories skip hover assertions.
export const forceHover = async (selector: string): Promise<ForcedHover | null> => {
  if (!cdp) return null
  const session = cdp()
  await session.send("DOM.enable")
  await session.send("CSS.enable")
  await session.send("DOM.getDocument", { depth: -1, pierce: true })
  const { searchId, resultCount } = await session.send("DOM.performSearch", { query: selector })
  if (resultCount === 0) throw new Error(`forceHover: nothing matches "${selector}"`)
  const { nodeIds } = await session.send("DOM.getSearchResults", {
    searchId,
    fromIndex: 0,
    toIndex: 1,
  })
  const nodeId = nodeIds[0]
  await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] })
  return {
    release: async () => {
      await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] })
    },
  }
}
