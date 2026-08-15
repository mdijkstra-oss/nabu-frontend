import { setCacheSkipped } from "~/lib/utils/storage-cache"
import { installRecorder, installedRecorder, type RecorderHandle } from "./recorder"

export const installHost = (): RecorderHandle => {
  installAnimationFrameShim()
  setCacheSkipped(true)
  return installedRecorder() ?? installRecorder()
}

const installAnimationFrameShim = (): void => {
  const scope = globalThis as { requestAnimationFrame?: unknown }
  if (typeof scope.requestAnimationFrame === "function") return
  scope.requestAnimationFrame = (callback: (time: number) => void): number => {
    queueMicrotask(() => callback(0))
    return 0
  }
}
