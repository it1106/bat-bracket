export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // BAT publishes AAAA records but ezebat.lan has no IPv6 route, so each
  // outbound call wastes a connect attempt before falling back to IPv4.
  // Prefer A records to skip the timeout.
  const dns = await import('node:dns')
  dns.setDefaultResultOrder('ipv4first')

  // Skip pre-warm on Vercel: serverless functions are stateless (cache resets each cold start)
  // and datacenter IPs are throttled by the upstream server
  if (!process.env.VERCEL) {
    const { prewarmDrawsCache } = await import('./lib/draws-cache')
    const { prewarmBracketCache } = await import('./lib/bracket-cache')

    // Fire-and-forget: pre-warm draws first, then all brackets
    ;(async () => {
      await prewarmDrawsCache()
      await prewarmBracketCache()
    })().catch((err) => console.warn('[instrumentation] prewarm error:', err))
  }
}
