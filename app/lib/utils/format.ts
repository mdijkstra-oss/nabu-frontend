export const concatPretty = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} & ${items.at(-1)}`
