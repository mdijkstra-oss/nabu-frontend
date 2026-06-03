import { useMemo } from "react"

export const useStableRef = <T>(value: T): T =>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => value, [JSON.stringify(value)])
