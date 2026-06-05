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
      const { activeData: bootActiveData } = await prewarmMatchesFullCache()
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
        const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin), activeData: bootActiveData })
        console.log(`[player-index] boot rebuild: ${JSON.stringify(result)}`)
      } catch (err) {
        console.warn('[player-index] boot rebuild failed:', err)
      }
      // Preload stats cache for every already-pinned tournament. The
      // generator is a no-op when an envelope is already current, so this
      // pass is cheap on subsequent boots — it only does real work for the
      // tail of tournaments that pinned without anyone ever opening their
      // stats panel.
      try {
        const port = process.env.PORT || '3000'
        const origin = `http://127.0.0.1:${port}`
        const { ensureStatsCachedForTournament } = await import('./lib/stats-generator')
        const fs = await import('fs')
        const path = await import('path')
        const fullDir = path.join(process.cwd(), '.cache', 'full')
        const files = await fs.promises.readdir(fullDir).catch(() => [] as string[])
        const ids = files
          .filter(f => f.endsWith('.json'))
          .map(f => f.replace(/\.json$/, '').toUpperCase())
        let wrote = 0, fresh = 0, skip = 0
        for (const id of ids) {
          const res = await ensureStatsCachedForTournament(id, origin)
          if (res === 'wrote') wrote++
          else if (res === 'fresh') fresh++
          else skip++
        }
        console.log(`[stats-cache] boot preload: wrote=${wrote} fresh=${fresh} skip=${skip} total=${ids.length}`)
      } catch (err) {
        console.warn('[stats-cache] boot preload failed:', err)
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
      const port = process.env.PORT || '3000'
      const origin = `http://127.0.0.1:${port}`
      const tick = async () => {
        try {
          const h = getBangkokHour()
          if (h >= 0 && h < 8) {
            console.log('[discovery] quiet window, skipping')
            return
          }
          await runDiscoveryCycle(deps)
          // Pin any tournament that has just finished (every match-day now in
          // the past) and rebuild the player index, so completed events appear
          // in profiles and leaderboards without waiting for a redeploy. This
          // runs on the discovery cadence (every 15 min, modulo the overnight
          // quiet window). rebuildAll is skipped unless something newly pinned,
          // and is itself a no-op when the source version is unchanged.
          const { newlyPinned, activeData } = await prewarmMatchesFullCache()
          if (newlyPinned.length > 0 || activeData.size > 0) {
            if (newlyPinned.length > 0) {
              console.log(`[auto-rebuild] tournaments completed: ${newlyPinned.join(', ')}`)
            }
            const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin), activeData })
            console.log(`[auto-rebuild] player index rebuilt: ${JSON.stringify(result)}`)
          }
          // Newly-pinned tournaments: preload their stats so the first user
          // to open the panel gets the cached aggregate, not a fresh compute.
          if (newlyPinned.length > 0) {
            const { ensureStatsCachedForTournament } = await import('./lib/stats-generator')
            for (const id of newlyPinned) {
              const res = await ensureStatsCachedForTournament(id.toUpperCase(), origin)
              console.log(`[stats-cache] tick newlyPinned id=${id} status=${res}`)
            }
          }
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
      //
      // When no BWF tournament is active, a browser may still be open from the
      // last sparse request (users viewing finished events). Skipping the tick
      // would leave that browser holding the bwfbadminton.com primer page open
      // for hours — its own ad/analytics JS leaks ~1 GB per ~30 min, which is
      // the overnight (9pm–7am) container-memory spike. So when idle we close
      // it outright instead; the next request re-primes cold.
      const bwfRecycleTick = async () => {
        const hasActiveBwf = listAllTournaments().some((t) => t.provider === 'bwf' && !t.done)
        try {
          const cf = await import('./lib/providers/bwf/cf-context')
          if (hasActiveBwf) await cf.primeIfNeeded()
          else await cf.closeContext()
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          console.warn(`[bwf-recycle] tick failed: ${msg}`)
        }
      }
      setInterval(bwfRecycleTick, 5 * 60 * 1000)

      // Ranking weekly refresh — one poll per provider. Each upstream
      // publishes once a week (BAT on Tuesday, BWF on Wednesday in BKK
      // time); we cheaply peek the overview page every 30 min inside the
      // configured window and only fire the full per-category refresh
      // when publishDate changes. See lib/ranking/scheduler.ts.
      const { decideTick, decideBootKick, publishDateChanged } = await import('./lib/ranking/scheduler')
      const { PROVIDER_CONFIG } = await import('./lib/ranking/config')
      const { getBangkokClock } = await import('./lib/today')
      const { rankingFetch } = await import('./lib/ranking/fetch')
      const { parsePublishDate } = await import('./lib/ranking/scraper')
      const { readRankingCache } = await import('./lib/ranking/cache')

      const peekAndMaybeRefresh = async (provider: 'bat' | 'bwf') => {
        const cfg = PROVIDER_CONFIG[provider]
        try {
          const overviewRes = await rankingFetch(provider, 'poll-overview', cfg.overviewUrl)
          if (!overviewRes.ok) {
            console.log(`[ranking/${provider}/poll] overview status=${overviewRes.status}, skipping`)
            return
          }
          const html = await overviewRes.text()
          const upstreamPublishDate = parsePublishDate(html)
          const cached = await readRankingCache(provider)
          const cachedPublishDate = cached?.publishDate ?? null
          if (!publishDateChanged(cachedPublishDate, upstreamPublishDate)) {
            console.log(`[ranking/${provider}/poll] publishDate unchanged (${upstreamPublishDate || 'unparsable'}), no refresh`)
            return
          }
          console.log(`[ranking/${provider}/poll] new publishDate: ${cachedPublishDate ?? '(none)'} -> ${upstreamPublishDate}, triggering refresh`)
          const refreshRes = await fetch(`${origin}/api/ranking/${provider}/refresh?force=true`, { method: 'POST' })
          const body = await refreshRes.text()
          console.log(`[ranking/${provider}/poll] refresh status=${refreshRes.status} body=${body.slice(0, 200)}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          console.warn(`[ranking/${provider}/poll] tick failed: ${msg}`)
        }
      }

      for (const provider of ['bat', 'bwf'] as const) {
        const cfg = PROVIDER_CONFIG[provider]
        const tick = async () => {
          const action = decideTick({ clock: getBangkokClock(), schedule: cfg.pollSchedule })
          if (action === 'skip') return
          await peekAndMaybeRefresh(provider)
        }
        setTimeout(async () => {
          const cached = await readRankingCache(provider)
          const cacheAgeMs = cached ? Date.now() - new Date(cached.scrapedAt).getTime() : null
          const action = decideBootKick({ clock: getBangkokClock(), schedule: cfg.pollSchedule, cacheAgeMs })
          if (action === 'peek-and-maybe-refresh') {
            const ageHrs = cacheAgeMs === null ? 'no-cache' : `${(cacheAgeMs / 3_600_000).toFixed(1)}h`
            console.log(`[ranking/${provider}/poll] boot kick (cacheAge=${ageHrs})`)
            await peekAndMaybeRefresh(provider)
          }
        }, 45_000)
        setInterval(tick, 30 * 60 * 1000)
      }
    }
  }
}
