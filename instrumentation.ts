export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prewarmDrawsCache } = await import('./lib/draws-cache')
    const { prewarmBracketCache } = await import('./lib/bracket-cache')

    // Fire-and-forget: pre-warm draws first, then all brackets
    ;(async () => {
      await prewarmDrawsCache()
      await prewarmBracketCache()
    })().catch((err) => console.warn('[instrumentation] prewarm error:', err))
  }
}
