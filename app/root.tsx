import { useCallback, useEffect, useState } from "react"
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router"
import { AnimatePresence } from "framer-motion"
import { Trash2, FolderInput, Sparkles } from "lucide-react"

import type { Route } from "./+types/root"
import { FloatingActionBar } from "~/ui/components/FloatingActionBar"
import "./styles/index.css"

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=swap",
  },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

const _noop = () => undefined

const STUB_ACTIONS = [
  { icon: <Trash2 />, label: "Delete", onClick: _noop, variant: "default" as const },
  { icon: <FolderInput />, label: "Move", onClick: _noop, variant: "default" as const },
  { icon: <Sparkles />, label: "Code file", onClick: _noop, variant: "ai" as const },
  { icon: <Sparkles />, label: "Merge", onClick: _noop, variant: "ai" as const },
]

const REAPPEAR_DELAY_MS = 2000

export default function App() {
  const [visible, setVisible] = useState(true)

  const handleClose = useCallback(() => setVisible(false), [])

  useEffect(() => {
    if (visible) return
    const timer = setTimeout(() => setVisible(true), REAPPEAR_DELAY_MS)
    return () => clearTimeout(timer)
  }, [visible])

  return (
    <>
      <Outlet />
      <AnimatePresence>
        {visible && (
          <FloatingActionBar
            title="3 codes selected"
            titleAction={{ label: "Select all 9", onClick: _noop }}
            onClose={handleClose}
            actions={STUB_ACTIONS}
          />
        )}
      </AnimatePresence>
    </>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error"
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
