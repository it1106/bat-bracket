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

      // BAT ranking weekly refresh. Upstream publishes once a week on Tuesday
      // at no fixed time, so we poll cheaply every 30 min during a generous
      // Tuesday window (08:00–23:30 BKK) and only trigger the expensive full
      // refresh when the parsed publishDate actually changes. See
      // lib/bat-ranking-scheduler.ts for the decision logic.
      const { decideTick, decideBootKick, publishDateChanged } = await import('./lib/bat-ranking-scheduler')
      const { getBangkokClock } = await import('./lib/today')
      const { batFetch } = await import('./lib/bat-fetch')
      const { parsePublishDate } = await import('./lib/bat-ranking-scraper')
      const { readBatRankingCache } = await import('./lib/bat-ranking-cache')

      const RANKING_OVERVIEW_URL = 'https://bat.tournamentsoftware.com/ranking/ranking.aspx?rid=188'
      const RANKING_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }

      const peekAndMaybeRefresh = async () => {
        try {
          const overviewRes = await batFetch('ranking-poll-overview', RANKING_OVERVIEW_URL, { headers: RANKING_UA })
          if (!overviewRes.ok) {
            console.log(`[bat-ranking/poll] overview status=${overviewRes.status}, skipping`)
            return
          }
          const html = await overviewRes.text()
          const upstreamPublishDate = parsePublishDate(html)
          const cached = await readBatRankingCache()
          const cachedPublishDate = cached?.publishDate ?? null
          if (!publishDateChanged(cachedPublishDate, upstreamPublishDate)) {
            console.log(`[bat-ranking/poll] publishDate unchanged (${upstreamPublishDate || 'unparsable'}), no refresh`)
            return
          }
          console.log(`[bat-ranking/poll] new publishDate: ${cachedPublishDate ?? '(none)'} -> ${upstreamPublishDate}, triggering refresh`)
          // ?force=true so the route's 24h TTL guard doesn't block us — we've
          // already done our own publishDate-based gating above.
          const refreshRes = await fetch(`${origin}/api/bat-ranking/refresh?force=true`, { method: 'POST' })
          const body = await refreshRes.text()
          console.log(`[bat-ranking/poll] refresh status=${refreshRes.status} body=${body.slice(0, 200)}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          console.warn(`[bat-ranking/poll] tick failed: ${msg}`)
        }
      }

      const rankingTick = async () => {
        const action = decideTick({ clock: getBangkokClock() })
        if (action === 'skip') return
        await peekAndMaybeRefresh()
      }

      // Boot kick. Fires immediately on boot when either (a) today is
      // Tuesday in Bangkok inside the polling window, or (b) the cache is
      // older than 6 days — which catches the "scheduler just got deployed
      // and the cache is already a week stale" case (otherwise the very
      // first deploy of this feature would do nothing until next Tuesday)
      // and the "server was down through last Tuesday" case.
      setTimeout(async () => {
        const cached = await readBatRankingCache()
        const cacheAgeMs = cached
          ? Date.now() - new Date(cached.scrapedAt).getTime()
          : null
        const action = decideBootKick({ clock: getBangkokClock(), cacheAgeMs })
        if (action === 'peek-and-maybe-refresh') {
          const ageHrs = cacheAgeMs === null ? 'no-cache' : `${(cacheAgeMs / 3_600_000).toFixed(1)}h`
          console.log(`[bat-ranking/poll] boot kick (cacheAge=${ageHrs})`)
          await peekAndMaybeRefresh()
        }
      }, 45_000)

      setInterval(rankingTick, 30 * 60 * 1000)
    }
  }
}
