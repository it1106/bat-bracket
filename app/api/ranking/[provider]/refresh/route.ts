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
import type { Ranking, RankingEntry, RankingEvent, ProviderTag } from '@/lib/types'

const TTL_MS = 24 * 60 * 60 * 1000

interface Ctx { params: { provider: string } }

export async function POST(req: Request, ctx: Ctx) {
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
    const overviewRes = await rankingFetch(provider, 'overview', cfg.overviewUrl)
    if (!overviewRes.ok) {
      return NextResponse.json({ error: `upstream ${overviewRes.status}` }, { status: 502 })
    }
    const overviewHtml = await overviewRes.text()
    const publishDate = parsePublishDate(overviewHtml)
    const categories = parseCategoryList(overviewHtml)
    const rankingId = parseRankingId(overviewHtml)
    const previousRankingId = parsePreviousRankingId(overviewHtml)

    if (categories.length === 0) {
      return NextResponse.json({ error: 'no categories found on overview page' }, { status: 502 })
    }
    if (!rankingId) {
      return NextResponse.json({ error: 'rankingId not found on overview page' }, { status: 502 })
    }

    // Upstream caps `ps` at 100 per page, so loop pages 1..maxPages until
    // we hit the target, get an empty page, or get a short page (last).
    const scrapeEvents = async (rid: string, maxPages: number, target: number): Promise<RankingEvent[]> => {
      const evs: RankingEvent[] = []
      for (const cat of categories) {
        const entries: RankingEntry[] = []
        try {
          for (let page = 1; page <= maxPages; page++) {
            const url = cfg.categoryUrl(rid, cat.id, page)
            const res = await rankingFetch(provider, 'cat', url)
            if (!res.ok) break
            const html = await res.text()
            const pageEntries = parseCategoryPage(html)
            if (pageEntries.length === 0) break
            entries.push(...pageEntries)
            if (entries.length >= target || pageEntries.length < 100) break
          }
        } catch { /* skip failed categories */ }
        if (entries.length > target) entries.length = target
        if (entries.length > 0) {
          evs.push({ eventCode: eventCodeFromName(cat.name), eventName: cat.name, entries })
        }
      }
      return evs
    }

    const events = await scrapeEvents(rankingId, 5, 500)

    // Don't overwrite a populated cache with nothing.
    if (events.length === 0) {
      console.log(`[ranking/${provider}/refresh] all categories empty; cache preserved`)
      return NextResponse.json({ error: 'no entries scraped; cache preserved' }, { status: 502 })
    }

    // Scrape the prior publication to get a fresh, deploy-independent source
    // for `previousRank`. Capped at 2 pages (200 rows) per event — anyone
    // currently in the rendered top-100 who fell from below rank 200 is a
    // 100+ position swing in one week and rare enough to live with "NEW".
    // Fall back to the local cache if upstream prev fetch yields nothing.
    let prevForMerge: Ranking | null = null
    if (previousRankingId) {
      try {
        const prevEvents = await scrapeEvents(previousRankingId, 2, 200)
        if (prevEvents.length > 0) {
          prevForMerge = {
            provider, scrapedAt: new Date().toISOString(),
            publishDate: `__prev_${previousRankingId}`,
            rankingId: previousRankingId, events: prevEvents,
          }
        }
      } catch { /* fall through to cache fallback */ }
    }
    if (!prevForMerge) prevForMerge = await readRankingCache(provider)

    const scrapedAt = new Date().toISOString()
    const eventsWithPrev = mergePreviousRanks(prevForMerge, events, publishDate)
    await writeRankingCache({ provider, scrapedAt, publishDate, rankingId, events: eventsWithPrev })
    console.log(`[ranking/${provider}/refresh] ok eventsFound=${events.length} publishDate=${publishDate} prev=${previousRankingId ?? 'none'}`)
    return NextResponse.json({ scrapedAt, eventsFound: events.length, previousRankingId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[ranking/${provider}/refresh] error err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
