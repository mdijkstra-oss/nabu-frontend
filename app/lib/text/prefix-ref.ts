export interface ParsedRef {
  prefix: string
  n: number
}

export const toLetter = (index: number): string => {
  let result = ""
  let n = index
  do {
    result = String.fromCharCode(97 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

const isLowerAlpha = (ch: string): boolean => ch >= "a" && ch <= "z"

const splitPrefixDigits = (ref: string): { prefix: string; digits: string } | null => {
  let i = 0
  while (i < ref.length && isLowerAlpha(ref[i])) i++
  if (i === 0 || i === ref.length) return null
  return { prefix: ref.slice(0, i), digits: ref.slice(i) }
}

export const parseRef = (ref: string, separator: string): ParsedRef | null => {
  if (ref.length < 2) return null

  if (separator === "") {
    const split = splitPrefixDigits(ref)
    if (!split) return null
    const n = Number(split.digits)
    if (!Number.isInteger(n) || n < 1) return null
    return { prefix: split.prefix, n }
  }

  const sepIdx = ref.indexOf(separator)
  if (sepIdx <= 0 || sepIdx === ref.length - 1) return null
  const prefix = ref.slice(0, sepIdx)
  for (const ch of prefix) if (!isLowerAlpha(ch)) return null
  const n = Number(ref.slice(sepIdx + separator.length))
  if (!Number.isInteger(n) || n < 1) return null
  return { prefix, n }
}
