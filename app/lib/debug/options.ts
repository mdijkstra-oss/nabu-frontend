export type DebugOptions = Record<string, boolean>

let current: DebugOptions = {}

export const publishDebugOptions = (options: DebugOptions): void => {
  current = options
}

export const isDebugOn = (key: string): boolean => !!current[key]

export const getDebugOptions = (): DebugOptions => current
