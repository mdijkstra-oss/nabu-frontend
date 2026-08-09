import { useEffect, useState } from "react"
import type { Decorator } from "@storybook/react-vite"
import { MemoryRouter, Route, Routes } from "react-router"
import { getFiles, setFiles, withoutPersist, type FileStore } from "~/lib/files/store"

interface SizeParams {
  width?: string
  height?: string
  className?: string
}

export const withSize =
  ({ width, height, className }: SizeParams): Decorator =>
  (Story) => (
    <div className={className} style={{ width, height }}>
      <Story />
    </div>
  )

export const withRouter =
  (initialPath = "/"): Decorator =>
  (Story) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/project/:projectId/file/:fileId" element={<Story />} />
        <Route path="/project/:projectId/search/:searchId" element={<Story />} />
        <Route path="/project/:projectId/*" element={<Story />} />
        <Route path="*" element={<Story />} />
      </Routes>
    </MemoryRouter>
  )

const SeededFiles = ({ seed, children }: { seed: FileStore; children: React.ReactNode }) => {
  const [prior] = useState(() => {
    const snapshot = { ...getFiles() }
    withoutPersist(() => setFiles({ ...seed }))
    return snapshot
  })

  useEffect(() => () => withoutPersist(() => setFiles(prior)), [prior])

  return <>{children}</>
}

export const withSeededFiles =
  (seed: FileStore): Decorator =>
  (Story) => (
    <SeededFiles seed={seed}>
      <Story />
    </SeededFiles>
  )
