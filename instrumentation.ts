export async function register() {
  // Skip pre-warm on Vercel: serverless functions are stateless (cache resets each cold start)
  // and datacenter IPs are throttled by the upstream server
  if (process.env.NEXT_RUNTIME === 'nodejs' && !process.env.VERCEL) {
    const { prewarmDrawsCache } = await import('./lib/draws-cache')
    const { prewarmBracketCache } = await import('./lib/bracket-cache')

    // Fire-and-forget: pre-warm draws first, then all brackets
    ;(async () => {
      await prewarmDrawsCache()
      await prewarmBracketCache()
    })().catch((err) => console.warn('[instrumentation] prewarm error:', err))
  }
}
