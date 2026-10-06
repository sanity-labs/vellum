import { AnalyticsInit } from '@sanity/frontend-analytics'
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'
import { rudderstackConfig, trackPageView } from '../app/analytics'
import styles from '../app/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#f8f9f7' },
      { title: 'Vellum: Text into structure' },
    ],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <main className="p-6">
      Page not found. <a href="/">Open Vellum</a>
    </main>
  ),
})

/** RudderStack is not consent-gated, matching www.sanity.io and research.sanity.io. */
function RootComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  // biome-ignore lint/correctness/useExhaustiveDependencies: one page view per path
  useEffect(() => {
    trackPageView()
  }, [pathname])
  return (
    <>
      <AnalyticsInit config={rudderstackConfig()} />
      <Outlet />
    </>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
