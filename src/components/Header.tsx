import { Link } from "@tanstack/react-router"

import { useState } from "react"

export default function Header() {
  const [isOpen, setIsOpen] = useState(false)
  const [groupedExpanded, setGroupedExpanded] = useState<Record<string, boolean>>({})

  return (
    <>
      <header>
        <button onClick={() => setIsOpen(true)} aria-label="Open menu">
          ⋯
        </button>
        <h1>
          <Link to="/">
            <img src="/tanstack-word-logo-white.svg" alt="TanStack Logo" />
          </Link>
        </h1>
      </header>

      <aside>
        <div>
          <h2>Navigation</h2>
          <button onClick={() => setIsOpen(false)} aria-label="Close menu">
            ×
          </button>
        </div>

        <nav>
          <Link to="/" onClick={() => setIsOpen(false)}>
            🏠<span>Home</span>
          </Link>

          {/* Demo Links Start */}

          <Link to="/demo/start/server-funcs" onClick={() => setIsOpen(false)}>
            √<span>Start - Server Functions</span>
          </Link>

          <Link to="/demo/start/api-request" onClick={() => setIsOpen(false)}>
            🛜<span>Start - API Request</span>
          </Link>

          <div>
            <Link to="/demo/start/ssr" onClick={() => setIsOpen(false)}>
              🗒️
              <span>Start - SSR Demos</span>
            </Link>
            <button
              onClick={() =>
                setGroupedExpanded((prev) => ({
                  ...prev,
                  StartSSRDemo: !prev.StartSSRDemo
                }))
              }
            >
              {groupedExpanded.StartSSRDemo ? "↓" : "→"}
            </button>
          </div>
          {groupedExpanded.StartSSRDemo && (
            <div>
              <Link to="/demo/start/ssr/spa-mode" onClick={() => setIsOpen(false)}>
                🗒️
                <span>SPA Mode</span>
              </Link>

              <Link to="/demo/start/ssr/full-ssr" onClick={() => setIsOpen(false)}>
                🗒️
                <span>Full SSR</span>
              </Link>

              <Link to="/demo/start/ssr/data-only" onClick={() => setIsOpen(false)}>
                🗒️
                <span>Data Only</span>
              </Link>
            </div>
          )}

          {/* Demo Links End */}
        </nav>
      </aside>
    </>
  )
}
