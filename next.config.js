/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['playwright-core', '@sparticuz/chromium'],
    instrumentationHook: true,
  },
}
module.exports = nextConfig
