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
import type { RankingEvent, ProviderTag } from '@/lib/types'

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

    const events: RankingEvent[] = []
    for (const cat of categories) {
      const url = cfg.categoryUrl(rankingId, cat.id)
      try {
        const res = await rankingFetch(provider, 'cat', url)
        if (!res.ok) continue
        const html = await res.text()
        const entries = parseCategoryPage(html)
        if (entries.length > 0) {
          events.push({ eventCode: eventCodeFromName(cat.name), eventName: cat.name, entries })
        }
      } catch { /* skip failed categories */ }
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
