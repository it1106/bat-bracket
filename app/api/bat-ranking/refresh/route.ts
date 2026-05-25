import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { parseCategoryList, parseCategoryPage, parsePublishDate, eventCodeFromName } from '@/lib/bat-ranking-scraper'
import { writeBatRankingCache } from '@/lib/bat-ranking-cache'
import type { BatRankingEvent } from '@/lib/types'

const BASE_URL = 'https://bat.tournamentsoftware.com/ranking'
const OVERVIEW_URL = `${BASE_URL}/ranking.aspx?rid=188`
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }

export async function POST() {
  try {
    // Step 1: fetch overview to get publish date and category list
    const overviewRes = await batFetch('ranking-overview', OVERVIEW_URL, { headers: UA })
    if (!overviewRes.ok) {
      return NextResponse.json({ error: `upstream ${overviewRes.status}` }, { status: 502 })
    }
    const overviewHtml = await overviewRes.text()
    const publishDate = parsePublishDate(overviewHtml)
    const categories = parseCategoryList(overviewHtml)

    if (categories.length === 0) {
      return NextResponse.json({ error: 'no categories found on overview page' }, { status: 502 })
    }

    // Step 2: fetch each category page (top 50 per event)
    const events: BatRankingEvent[] = []
    for (const cat of categories) {
      const url = `${BASE_URL}/category.aspx?id=51771&category=${cat.id}&ps=50`
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
    await writeBatRankingCache({ scrapedAt, publishDate, events })
    console.log(`[bat-ranking/refresh] ok eventsFound=${events.length} publishDate=${publishDate}`)
    return NextResponse.json({ scrapedAt, eventsFound: events.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-ranking/refresh] error err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
