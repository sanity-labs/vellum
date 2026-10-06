import { analyticsClient, type Config } from '@sanity/frontend-analytics'

/** Write keys are public client identifiers, the same pair research.sanity.io ships. */
const PROD_WRITE_KEY = '1pbJQE7iSfjDrVPwEpPZcVljld1'
const DEV_WRITE_KEY = '1pbJNcEJHWOe3DvdPyIp7XDICJ4'
const PROD_HOST = 'vellum.sanity.dev'

/**
 * Only the browser ever loads RudderStack, so the server render gets the production values and
 * ignores them. Previews and localhost go to the staging source unless the env var overrides.
 */
export function rudderstackConfig(): Config {
  const browser = typeof window !== 'undefined'
  const origin = browser ? window.location.origin : `https://${PROD_HOST}`
  const hostname = browser ? window.location.hostname : PROD_HOST
  const envKey: unknown = import.meta.env.VITE_RUDDERSTACK_WRITE_KEY
  return {
    applicationName: 'vellum',
    writeKey:
      (typeof envKey === 'string' && envKey.trim()) ||
      (hostname === PROD_HOST ? PROD_WRITE_KEY : DEV_WRITE_KEY),
    // Same-origin paths, proxied to RudderStack by the route rules in vite.config.ts.
    dataPlaneUrl: `${origin}/intake/dp`,
    configUrl: `${origin}/intake/api/sourceConfig`,
    cookieDomain: hostname,
    debug: import.meta.env.DEV,
  }
}

/**
 * `analyticsClient` drops calls made before the SDK has loaded, so every event waits for
 * `ready()`. A blocked or failed load must not surface as an unhandled rejection.
 */
function whenReady(send: () => void) {
  analyticsClient
    .ready()
    .then(send)
    .catch(() => {})
}

/** Lands under the `vellum` event name, with the real name in `eventAction`. */
function track(event: string, properties: Record<string, string>) {
  whenReady(() => analyticsClient.track(event, properties))
}

export function trackPageView() {
  whenReady(() => analyticsClient.page('vellum-sanity-dev', 'vellum'))
}

export function trackSanityLinkClicked(placement: string, href: string) {
  track('Vellum Sanity Link Clicked', { placement, href })
}

export function trackConversionStarted(mode: 'create' | 'rebuild' | 'update', schema: string) {
  track('Vellum Conversion Started', { mode, schema })
}
