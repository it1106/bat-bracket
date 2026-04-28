/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['playwright-core', '@sparticuz/chromium'],
    instrumentationHook: true,
  },
  // Vercel auto-sets VERCEL_ENV at build time but only exposes it server-side.
  // Re-export it under a NEXT_PUBLIC_ prefix so the client bundle (PostHog
  // deployment tag) can read it. Falls back to empty string off Vercel.
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || '',
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
}
module.exports = nextConfig
