import { NextResponse } from 'next/server'
import { rankingFetch } from '@/lib/ranking/fetch'
import { getRankingConfig } from '@/lib/ranking/config'
import {
  parseCategoryList,
  parseCategoryPage,
  parsePublishDate,
  eventCodeFromName,
  parseRankingId,
} from '@/lib/ranking/scraper'
import { readRankingCache, writeRankingCache } from '@/lib/ranking/cache'
import type { RankingEntry, RankingEvent, ProviderTag } from '@/lib/types'

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

    if (categories.length === 0) {
      return NextResponse.json({ error: 'no categories found on overview page' }, { status: 502 })
    }
    if (!rankingId) {
      return NextResponse.json({ error: 'rankingId not found on overview page' }, { status: 502 })
    }

    // Upstream caps `ps` at 100 per page, so loop pages 1..MAX_PAGES until
    // we hit the TARGET, get an empty page, or get a short page (last).
    // BWF Asia U-XX events are small and we only surface the top 10 on
    // the leaderboards, so one page is enough; BAT covers a larger pool.
    const TARGET = provider === 'bwf' ? 100 : 500
    const MAX_PAGES = provider === 'bwf' ? 1 : 5
    const events: RankingEvent[] = []
    for (const cat of categories) {
      const entries: RankingEntry[] = []
      try {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const url = cfg.categoryUrl(rankingId, cat.id, page)
          const res = await rankingFetch(provider, 'cat', url)
          if (!res.ok) break
          const html = await res.text()
          const pageEntries = parseCategoryPage(html)
          if (pageEntries.length === 0) break
          entries.push(...pageEntries)
          if (entries.length >= TARGET || pageEntries.length < 100) break
        }
      } catch { /* skip failed categories */ }
      if (entries.length > TARGET) entries.length = TARGET
      if (entries.length > 0) {
        events.push({ eventCode: eventCodeFromName(cat.name), eventName: cat.name, entries })
      }
    }

    // Don't overwrite a populated cache with nothing.
    if (events.length === 0) {
      console.log(`[ranking/${provider}/refresh] all categories empty; cache preserved`)
      return NextResponse.json({ error: 'no entries scraped; cache preserved' }, { status: 502 })
    }

    const scrapedAt = new Date().toISOString()
    await writeRankingCache({ provider, scrapedAt, publishDate, rankingId, events })
    console.log(`[ranking/${provider}/refresh] ok eventsFound=${events.length} publishDate=${publishDate}`)
    return NextResponse.json({ scrapedAt, eventsFound: events.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[ranking/${provider}/refresh] error err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
