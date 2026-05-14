export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && !process.env.VERCEL) {
    const dns = await import('dns')
    dns.setDefaultResultOrder('ipv4first')

    const { prewarmDrawsCache } = await import('./lib/draws-cache')
    const { prewarmBracketCache } = await import('./lib/bracket-cache')
    const { prewarmEventBundleCache } = await import('./lib/event-bundle-cache')
    const { prewarmMatchesFullCache } = await import('./lib/matches-full-cache')
    const { runDiscoveryCycle, buildDefaultDeps } = await import('./lib/discovery-runner')
    const { getBangkokHour } = await import('./lib/today')

    ;(async () => {
      await prewarmMatchesFullCache()
      await prewarmDrawsCache()
      await prewarmBracketCache()
      await prewarmEventBundleCache()
      // BWF: prime Chromium context so first user request doesn't pay cold-start.
      try {
        const { primeIfNeeded } = await import('./lib/providers/bwf/cf-context')
        await primeIfNeeded()
        console.log('[instrumentation] BWF CF context primed')
      } catch (err) {
        console.warn('[instrumentation] BWF prime failed (BWF tournaments will 503 until manual retry):', err)
      }
    })().catch((err) => console.warn('[instrumentation] prewarm error:', err))

    // Leader-only across PM2 workers. Today this is a 1-worker cluster, so
    // we run unconditionally on the worker (NODE_APP_INSTANCE may be 0, 1, or
    // undefined depending on how PM2 was started — none of which signals
    // "not the leader" when there's only one worker). If we ever scale to N>1,
    // change this to gate on "lowest NODE_APP_INSTANCE".
    const isLeader = true
    if (isLeader) {
      const deps = buildDefaultDeps()
      const tick = async () => {
        try {
          const h = getBangkokHour()
          if (h >= 0 && h < 8) {
            console.log('[discovery] quiet window, skipping')
            return
          }
          await runDiscoveryCycle(deps)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          console.warn(`[discovery] tick failed: ${msg}`)
        }
      }
      setTimeout(tick, 30_000)
      setInterval(tick, 15 * 60 * 1000)
    }
  }
}
