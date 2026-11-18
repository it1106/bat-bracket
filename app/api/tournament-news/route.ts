import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { loadDiscovered } from '@/lib/discovery-store'
import { mergeForApi } from '@/lib/tournaments-merge'
import { parseTournamentsTxt } from '@/lib/tournaments-txt'
import { recentlyAddedTournaments, recentUpdates } from '@/lib/tournament-news'
import { loadNews } from '@/lib/site-news'
import { getTodayIso } from '@/lib/today'

export const dynamic = 'force-dynamic'

// GET /api/tournament-news  →  { tournaments: [{ id, name, addedAt }],
//                                updates: [{ id, kind, tournamentId, tournamentName, items, addedAt }] }
// Public: tournaments the site added by itself in the last few days, and draws
// and schedules first published in that time, for the news pop-up. Each
// browser remembers which ids it has seen.
export async function GET() {
  let txt: ReturnType<typeof parseTournamentsTxt>
  try {
    txt = parseTournamentsTxt(readFileSync(join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8'))
  } catch {
    txt = { manualEntries: [], denySet: new Set(), denyNamePatterns: [], levelOverrides: new Map() }
  }
  const discovered = await loadDiscovered()
  const visible = mergeForApi(txt.manualEntries, txt.denySet, discovered, txt.denyNamePatterns)
  const now = Date.now()
  const tournaments = recentlyAddedTournaments(discovered, visible, now)
  const updates = recentUpdates(await loadNews(), visible, now, getTodayIso())
  return NextResponse.json({ tournaments, updates }, { headers: { 'Cache-Control': 'no-store' } })
}
