/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['playwright-core', '@sparticuz/chromium'],
    instrumentationHook: true,
  },
  // Same-origin reverse proxy for PostHog so ad-blockers (which hard-block
  // *.posthog.com) don't drop ~25-30% of events. Browser sends to /ingest/...
  // on our own domain; Next rewrites it to PostHog EU at the edge.
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*',        destination: 'https://eu.i.posthog.com/:path*' },
      { source: '/ingest/decide',        destination: 'https://eu.i.posthog.com/decide' },
    ]
  },
  // PostHog rejects requests with a trailing slash; this stops Next from
  // adding one to /ingest/decide and friends.
  skipTrailingSlashRedirect: true,
  // Next.js 14 hardcodes crossorigin="use-credentials" on the manifest <link>,
  // which makes Chrome's installability check perform a CORS-with-credentials
  // fetch even on same-origin. Without these headers Chrome silently rejects
  // the manifest and the "Install app" button never appears.
  async headers() {
    return [
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: 'https://batmatch.app' },
        ],
      },
    ]
  },
}
module.exports = nextConfig
