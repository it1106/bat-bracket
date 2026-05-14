import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { readFullCache, isAllPast } from '@/lib/day-cache'
import { getTodayIso } from '@/lib/today'
import { loadDiscovered } from '@/lib/discovery-store'
import { mergeForApi, sortNewestFirst } from '@/lib/tournaments-merge'
import { parseTournamentsTxt as parseFromTxt, type ParsedTxt } from '@/lib/tournaments-txt'
import { resolveBwfUrl } from '@/lib/providers/bwf/url-resolver-runtime'
import type { TournamentInfo } from '@/lib/types'

// Force dynamic so auto-done flips and newly-discovered entries are reflected
// on the very next request. Cost is a few file stats per call, trivially cheap.
export const dynamic = 'force-dynamic'

function parseTournamentsTxt(): ParsedTxt {
  try {
    const content = readFileSync(join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8')
    return parseFromTxt(content, {
      onUnresolved: (url) => { resolveBwfUrl(url).catch(() => {}) },
    })
  } catch {
    return { manualEntries: [], denySet: new Set() }
  }
}

// One pass over the merged list: read each tournament's persisted full
// schedule (if any) to derive startDateIso (first match-day) and the
// auto-done flag. Both come from the same readFullCache call.
async function annotateEntries(
  entries: TournamentInfo[],
  todayIso: string,
): Promise<TournamentInfo[]> {
  const out: TournamentInfo[] = []
  for (const e of entries) {
    const cached = await readFullCache(e.id)
    const startDateIso = cached?.days[0]?.dateIso
    const autoDone = !e.done && cached ? isAllPast(cached, todayIso) : false
    const done = e.done || autoDone
    out.push({
      ...e,
      ...(done && { done: true }),
      ...(startDateIso && { startDateIso }),
    })
  }
  return out
}

export async function GET() {
  const { manualEntries, denySet } = parseTournamentsTxt()
  const discovered = await loadDiscovered()
  const merged = mergeForApi(manualEntries, denySet, discovered)
  const todayIso = getTodayIso()
  const annotated = await annotateEntries(merged, todayIso)
  const sorted = sortNewestFirst(annotated)
  return NextResponse.json(sorted)
}
