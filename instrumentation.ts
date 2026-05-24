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

    const { listAllTournaments } = await import('./lib/tournaments-registry')

    const { rebuildAll, makeOriginDayFetcher } = await import('./lib/player-index-rebuild')

    ;(async () => {
      await prewarmMatchesFullCache()
      await prewarmDrawsCache()
      await prewarmBracketCache()
      await prewarmEventBundleCache()

      // Build the cross-tournament player index from the now-warm caches.
      // ensureDay self-fetches any day not yet pinned (fresh server) via the
      // local matches route. Idempotent: skips providers whose sourceVersion
      // is unchanged, so reboots with a warm cache are cheap.
      try {
        const port = process.env.PORT || '3000'
        const origin = `http://127.0.0.1:${port}`
        const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin) })
        console.log(`[player-index] boot rebuild: ${JSON.stringify(result)}`)
      } catch (err) {
        console.warn('[player-index] boot rebuild failed:', err)
      }
      // BWF: prime Chromium context so first user request doesn't pay cold-start.
      // Skip if no BWF tournament is currently active — Chromium otherwise sits
      // around using ~250-500 MB for nothing. The first real BWF request will
      // prime lazily via primeIfNeeded() if one ever comes in.
      const hasActiveBwf = listAllTournaments().some((t) => t.provider === 'bwf' && !t.done)
      if (!hasActiveBwf) {
        console.log('[instrumentation] BWF prime skipped (no active BWF tournament)')
      } else {
        try {
          const { primeIfNeeded } = await import('./lib/providers/bwf/cf-context')
          await primeIfNeeded()
          console.log('[instrumentation] BWF CF context primed')
        } catch (err) {
          console.warn('[instrumentation] BWF prime failed (BWF tournaments will 503 until manual retry):', err)
        }
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

      // BWF Chromium recycle heartbeat. primeIfNeeded() only fires on the
      // first request after PRIME_TTL_MS — so during idle periods the heap
      // can drift past the cap unnoticed, get whacked by max_memory_restart
      // when the next traffic burst lands, and produce a reload-overlap
      // memory spike. This setInterval pokes it every 5 min so any expired
      // TTL gets honored regardless of demand.
      const bwfRecycleTick = async () => {
        const hasActiveBwf = listAllTournaments().some((t) => t.provider === 'bwf' && !t.done)
        if (!hasActiveBwf) return
        try {
          const { primeIfNeeded } = await import('./lib/providers/bwf/cf-context')
          await primeIfNeeded()
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          console.warn(`[bwf-recycle] tick failed: ${msg}`)
        }
      }
      setInterval(bwfRecycleTick, 5 * 60 * 1000)
    }
  }
}
