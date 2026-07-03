import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { readFullCache, isAllPast } from '@/lib/day-cache'
import { readMeta } from '@/lib/tournament-meta'
import { resolveBatLevel } from '@/lib/providers/bat-level-runtime'
import { getTodayIso } from '@/lib/today'
import { loadDiscovered } from '@/lib/discovery-store'
import { mergeForApi, sortTournamentsForDropdown } from '@/lib/tournaments-merge'
import { parseTournamentsTxt as parseFromTxt, type ParsedTxt } from '@/lib/tournaments-txt'
import { resolveBwfUrl } from '@/lib/providers/bwf/url-resolver-runtime'
import { lookupUrlByGuid } from '@/lib/providers/bwf/sidecar'
import type { TournamentInfo } from '@/lib/types'

// Link to a tournament's page on the official provider site. BAT ids are the
// tournamentsoftware GUID, so the URL is derivable directly; BWF ids resolve to
// the bwfbadminton.com page URL via the sidecar (null until first resolved).
function officialUrlFor(e: TournamentInfo): string | undefined {
  if (e.provider === 'bwf') return lookupUrlByGuid(e.id) ?? undefined
  return `https://bat.tournamentsoftware.com/tournament/${e.id}`
}

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
    return { manualEntries: [], denySet: new Set(), denyNamePatterns: [], levelOverrides: new Map() }
  }
}

// One pass over the merged list: derive startDateIso from the per-tournament
// meta sidecar (written on every successful full-matches fetch, so active
// tournaments expose a date too), falling back to the pinned full cache for
// done tournaments that predate the sidecar. Auto-done still requires the
// full cache since it needs every day's date to test isAllPast.
async function annotateEntries(
  entries: TournamentInfo[],
  todayIso: string,
  levelOverrides: Map<string, number>,
): Promise<TournamentInfo[]> {
  const out: TournamentInfo[] = []
  for (const e of entries) {
    const [meta, cached] = await Promise.all([readMeta(e.id), readFullCache(e.id)])
    const startDateIso = meta?.startDateIso ?? cached?.days[0]?.dateIso
    const autoDone = !e.done && cached ? isAllPast(cached, todayIso) : false
    const done = e.done || autoDone
    // Manual override wins over the auto-parsed level (for tournaments whose
    // regulations page omits a parseable level). Only background-fetch the
    // level when there's no override AND it hasn't been checked yet.
    const override = levelOverrides.get(e.id.toUpperCase())
    const isBat = !e.provider || e.provider === 'bat'
    if (isBat && override == null && !meta?.levelChecked) void resolveBatLevel(e.id)
    const level = override ?? meta?.level
    const officialUrl = officialUrlFor(e)
    out.push({
      ...e,
      ...(done && { done: true }),
      ...(startDateIso && { startDateIso }),
      ...(level != null && { level }),
      ...(officialUrl && { officialUrl }),
    })
  }
  return out
}

export async function GET() {
  const { manualEntries, denySet, denyNamePatterns, levelOverrides } = parseTournamentsTxt()
  const discovered = await loadDiscovered()
  const merged = mergeForApi(manualEntries, denySet, discovered, denyNamePatterns)
  const todayIso = getTodayIso()
  const annotated = await annotateEntries(merged, todayIso, levelOverrides)
  const sorted = sortTournamentsForDropdown(annotated)
  return NextResponse.json(sorted)
}
