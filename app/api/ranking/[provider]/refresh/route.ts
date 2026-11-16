import { NextResponse } from 'next/server'
import { rankingFetch } from '@/lib/ranking/fetch'
import { getRankingConfig } from '@/lib/ranking/config'
import {
  parseCategoryList,
  parseCategoryPage,
  parsePublishDate,
  eventCodeFromName,
  parseRankingId,
  parsePreviousRankingId,
} from '@/lib/ranking/scraper'
import { readRankingCache, writeRankingCache } from '@/lib/ranking/cache'
import { mergePreviousRanks } from '@/lib/ranking/previous-rank'
import { isInternalRequest } from '@/lib/internal-token'
import type { Ranking, RankingEntry, RankingEvent, RankingSeries, ProviderTag } from '@/lib/types'

const TTL_MS = 24 * 60 * 60 * 1000

interface Ctx { params: { provider: string } }

// Only the server's own ranking scheduler (instrumentation.ts) may start a
// refresh: one is hundreds of requests to the upstream, and this address is
// reachable by anyone. To run one by hand on the server:
//   curl -X POST -H "x-internal-token: $(cat .cache/internal-token)" \
//     'http://127.0.0.1:3000/api/ranking/bat/refresh?force=true'
export async function POST(req: Request, ctx: Ctx) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const provider = ctx.params.provider as ProviderTag
  if (provider !== 'bat' && provider !== 'bwf') {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  }
  const cfg = getRankingConfig(provider)
  const force = new URL(req.url).searchParams.get('force') === 'true'

  if (!force) {
    const cached = await readRankingCache(provider)
    if (cached) {
      const ageMs = Date.now() - new Date(cached.scrapedAt).getTime()
      if (ageMs < TTL_MS) {
        return NextResponse.json({
          skipped: true,
          reason: `cached data is only ${(ageMs / 3_600_000).toFixed(1)}h old (TTL 24h). Use ?force=true to override.`,
          scrapedAt: cached.scrapedAt,
          eventsFound: cached.events.length,
        })
      }
    }
  }

  try {
    // A provider can publish more than one ranking series (BAT: Open +
    // Junior since the 2569 split). Each has its own overview page, weekly
    // publication id and publish date; we scrape them in config order and
    // concatenate the events into one provider snapshot, stamping each
    // event with the series it came from so per-player detail URLs resolve
    // against the right publication.
    const previousCache = await readRankingCache(provider)
    const series: RankingSeries[] = []
    const allEvents: RankingEvent[] = []
    const failures: string[] = []
    // Series read whole from upstream this time.
    let readAfresh = 0
    // A series that upstream failed part-way through. Set when the cache
    // already holds that series: then nothing is written this time.
    let blocked = false

    // A series that upstream failed part-way through is never written short.
    // When the cache holds an earlier copy of it, the whole refresh stops and
    // the cache stays as it is: writing the other series alone would leave the
    // series at two different publications, and the projection's U15 detail
    // (lib/ranking/u15-cohort) reads one series' ranking id under the
    // envelope's date — it would fetch last week's detail and file it as this
    // week's. Leaving the cache untouched also leaves its date behind, so the
    // next poll inside the publish window asks again. A series the cache has
    // never held is simply left out, as before.
    const seriesFailed = (s: { id: string }, why: string) => {
      failures.push(`${s.id}: ${why}`)
      const held = previousCache?.events.some(e => (e.seriesId ?? cfg.series[0].id) === s.id)
      if (held) blocked = true
    }

    for (const s of cfg.series) {
      let overviewHtml: string
      try {
        const overviewRes = await rankingFetch(provider, 'overview', cfg.overviewUrl(s.id))
        if (!overviewRes.ok) { seriesFailed(s, `overview upstream ${overviewRes.status}`); continue }
        overviewHtml = await overviewRes.text()
      } catch (err) {
        seriesFailed(s, `overview ${err instanceof Error ? err.message : 'failed'}`)
        continue
      }
      const publishDate = parsePublishDate(overviewHtml)
      const categories = parseCategoryList(overviewHtml)
      const rankingId = parseRankingId(overviewHtml)
      const previousRankingId = parsePreviousRankingId(overviewHtml)

      // A retired series still serves a 200 with an empty publication
      // dropdown and no categories (rid=188 did exactly this after 28/7/2569,
      // rendering a bogus "1/1/0544" date). Treat that as a failure for this
      // series rather than silently contributing nothing.
      if (categories.length === 0) { failures.push(`${s.id}: no categories on overview page`); continue }
      if (!rankingId) { failures.push(`${s.id}: rankingId not found on overview page`); continue }

      // Upstream caps `ps` at 100 per page, so loop pages 1..maxPages until
      // we hit the target, get an empty page, or get a short page (last).
      //
      // A page that cannot be read (a failed or thrown request) fails its whole
      // category: the rows already read are the top of a list, not the list,
      // and are not kept. Such categories are named in `failed`.
      const scrapeEvents = async (
        rid: string, maxPages: number, target: number,
      ): Promise<{ events: RankingEvent[]; failed: string[] }> => {
        const evs: RankingEvent[] = []
        const failed: string[] = []
        for (const cat of categories) {
          const entries: RankingEntry[] = []
          let failure: string | null = null
          try {
            for (let page = 1; page <= maxPages; page++) {
              const url = cfg.categoryUrl(rid, cat.id, page)
              const res = await rankingFetch(provider, 'cat', url)
              if (!res.ok) { failure = `page ${page} upstream ${res.status}`; break }
              const html = await res.text()
              const pageEntries = parseCategoryPage(html)
              if (pageEntries.length === 0) break
              entries.push(...pageEntries)
              if (entries.length >= target || pageEntries.length < 100) break
            }
          } catch (err) {
            failure = err instanceof Error ? err.message : 'request failed'
          }
          if (failure) { failed.push(`${cat.name} (${failure})`); continue }
          if (entries.length > target) entries.length = target
          if (entries.length > 0) {
            evs.push({
              eventCode: eventCodeFromName(cat.name), eventName: cat.name, entries,
              seriesId: s.id, rankingId: rid,
            })
          }
        }
        return { events: evs, failed }
      }

      const { events, failed } = await scrapeEvents(rankingId, 5, 500)
      if (failed.length > 0) {
        seriesFailed(s, `${failed.length} of ${categories.length} categories not read — ${failed.join('; ')}`)
        continue
      }
      if (events.length === 0) { failures.push(`${s.id}: no entries scraped`); continue }

      // Scrape the prior publication to get a fresh, deploy-independent source
      // for `previousRank`. Capped at 2 pages (200 rows) per event — anyone
      // currently in the rendered top-100 who fell from below rank 200 is a
      // 100+ position swing in one week and rare enough to live with "NEW".
      // Fall back to the local cache if upstream prev fetch yields nothing, or
      // not all of it: the cache is whole, and a category missing here would
      // show every one of its rows as new.
      let prevForMerge: Ranking | null = null
      if (previousRankingId) {
        try {
          const prev = await scrapeEvents(previousRankingId, 2, 200)
          const prevEvents = prev.failed.length === 0 ? prev.events : []
          if (prevEvents.length > 0) {
            prevForMerge = {
              provider, scrapedAt: new Date().toISOString(),
              publishDate: `__prev_${previousRankingId}`,
              rankingId: previousRankingId,
              series: [{ seriesId: s.id, rankingId: previousRankingId, publishDate: `__prev_${previousRankingId}` }],
              events: prevEvents,
            }
          }
        } catch { /* fall through to cache fallback */ }
      }
      // Cache fallback is narrowed to this series' own events so a same-week
      // re-refresh doesn't match event codes across series.
      if (!prevForMerge && previousCache) {
        prevForMerge = {
          ...previousCache,
          events: previousCache.events.filter(e => (e.seriesId ?? cfg.series[0].id) === s.id),
        }
      }

      series.push({ seriesId: s.id, label: s.label, rankingId, publishDate })
      allEvents.push(...mergePreviousRanks(prevForMerge, events, publishDate))
      readAfresh++
    }

    if (blocked) {
      console.log(`[ranking/${provider}/refresh] a series failed part-way (${failures.join('; ')}); cache preserved`)
      return NextResponse.json({ error: `a series could not be read whole; cache preserved (${failures.join('; ')})` }, { status: 502 })
    }

    // Don't overwrite a populated cache with nothing.
    if (readAfresh === 0) {
      console.log(`[ranking/${provider}/refresh] no series yielded entries (${failures.join('; ')}); cache preserved`)
      return NextResponse.json({ error: `no entries scraped; cache preserved (${failures.join('; ')})` }, { status: 502 })
    }

    // The envelope keeps a single top-level publishDate/rankingId for the
    // primary (first-configured) series — that's what the alert bell and the
    // 52-week expiry math read. Both BAT series publish on the same Tuesday,
    // so this is exact today; were they ever to diverge, the non-primary
    // series' week math would be off by at most one week.
    const primary = series[0]
    const scrapedAt = new Date().toISOString()
    await writeRankingCache({
      provider, scrapedAt,
      publishDate: primary.publishDate,
      rankingId: primary.rankingId,
      series,
      events: allEvents,
    })
    console.log(`[ranking/${provider}/refresh] ok series=${series.map(s => `${s.seriesId}@${s.publishDate}`).join(',')} eventsFound=${allEvents.length}${failures.length ? ` failures=${failures.join('; ')}` : ''}`)
    return NextResponse.json({ scrapedAt, eventsFound: allEvents.length, series, failures })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[ranking/${provider}/refresh] error err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
