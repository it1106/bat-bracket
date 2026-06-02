import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { parseCategoryList, parseCategoryPage, parsePublishDate, eventCodeFromName, parseRankingId } from '@/lib/bat-ranking-scraper'
import { readBatRankingCache, writeBatRankingCache } from '@/lib/bat-ranking-cache'
import type { BatRankingEvent } from '@/lib/types'

const BASE_URL = 'https://bat.tournamentsoftware.com/ranking'
const OVERVIEW_URL = `${BASE_URL}/ranking.aspx?rid=188`
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export async function POST(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === 'true'

  if (!force) {
    const cached = await readBatRankingCache()
    if (cached) {
      const ageMs = Date.now() - new Date(cached.scrapedAt).getTime()
      if (ageMs < TTL_MS) {
        const ageHours = (ageMs / 3_600_000).toFixed(1)
        return NextResponse.json({
          skipped: true,
          reason: `cached data is only ${ageHours}h old (TTL 24h). Use ?force=true to override.`,
          scrapedAt: cached.scrapedAt,
          eventsFound: cached.events.length,
        })
      }
    }
  }

  try {
    const overviewRes = await batFetch('ranking-overview', OVERVIEW_URL, { headers: UA })
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
    // rankingId is the weekly edition id used in category.aspx?id=...; without
    // it we would have to hardcode a value that goes stale each Tuesday, which
    // is exactly the bug cf9a581 introduced — overview-derived publishDate
    // refreshes but per-category fetches pin to an old edition's snapshot.
    if (!rankingId) {
      return NextResponse.json({ error: 'rankingId not found on overview page' }, { status: 502 })
    }

    const events: BatRankingEvent[] = []
    for (const cat of categories) {
      const url = `${BASE_URL}/category.aspx?id=${rankingId}&category=${cat.id}&ps=50`
      try {
        const res = await batFetch('ranking-cat', url, { headers: UA })
        if (!res.ok) continue
        const html = await res.text()
        const entries = parseCategoryPage(html)
        if (entries.length > 0) {
          events.push({ eventCode: eventCodeFromName(cat.name), eventName: cat.name, entries })
        }
      } catch {
        // skip failed categories, continue with rest
      }
    }

    const scrapedAt = new Date().toISOString()
    await writeBatRankingCache({ scrapedAt, publishDate, rankingId, events })
    console.log(`[bat-ranking/refresh] ok eventsFound=${events.length} publishDate=${publishDate}`)
    return NextResponse.json({ scrapedAt, eventsFound: events.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-ranking/refresh] error err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
