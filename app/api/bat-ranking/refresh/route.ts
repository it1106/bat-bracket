import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { parseBatRanking } from '@/lib/bat-ranking-scraper'
import { writeBatRankingCache } from '@/lib/bat-ranking-cache'

const BAT_RANKING_URL = 'https://bat.tournamentsoftware.com/ranking/ranking.aspx?rid=188'

export async function POST() {
  try {
    const res = await batFetch('ranking', BAT_RANKING_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    })
    if (!res.ok) {
      console.log(`[bat-ranking/refresh] upstream error status=${res.status}`)
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 })
    }
    const html = await res.text()
    const ranking = parseBatRanking(html)
    await writeBatRankingCache(ranking)
    console.log(`[bat-ranking/refresh] ok eventsFound=${ranking.events.length} publishDate=${ranking.publishDate}`)
    return NextResponse.json({ scrapedAt: ranking.scrapedAt, eventsFound: ranking.events.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-ranking/refresh] error err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
