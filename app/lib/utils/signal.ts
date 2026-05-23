let activeSignal: AbortSignal | null = null

export const setActiveSignal = (signal: AbortSignal | null): void => {
  activeSignal = signal
}

export const getActiveSignal = (): AbortSignal | null => activeSignal
