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
}
module.exports = nextConfig
