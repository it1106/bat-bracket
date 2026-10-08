import { NextResponse } from 'next/server'
import { cache, rawHtmlCache, ttlMsFor, makeBracketKey, bracketHtmlForSchedule, ensureBracketsLoaded } from '@/lib/bracket-cache'
import { parseBracketRounds } from '@/lib/scraper'
import { buildBracketPath, isKnockout } from '@/lib/bracketPath'
import {
  pairRecord, rankCandidates, rankingEventCodeForDraw, teamRank,
  type PathResponse, type PathRoundOut,
} from '@/lib/pathEnrich'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { getCachedOrDisk } from '@/lib/draws-cache'
import { resolveRef } from '@/lib/tournaments-registry'
import { staleHeaders } from '@/lib/stale-headers'
import { batDownSince } from '@/lib/bat-outages'
import { readGlobalPlayerIds } from '@/lib/bat-player-id-map'
import { rankingSlugAlias } from '@/lib/ranking/aliases'

export const maxDuration = 30

// One player's path to the final of a knockout draw: the rounds they have
// played, their next match, and who could stand in each round after it.
// Built from the bracket this server already holds — it asks BAT for nothing
// beyond the one fetch bracketHtmlForSchedule makes for a bracket never seen.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const guid = (searchParams.get('tournament') ?? '').toLowerCase()
  const drawNum = searchParams.get('draw') ?? ''
  const playerId = searchParams.get('player') ?? ''
  if (!guid || !drawNum || !playerId) {
    return NextResponse.json({ error: 'tournament, draw and player params required' }, { status: 400 })
  }
  // These values go into a BAT URL and a cache key when the bracket is not
  // held, so only the shapes BAT itself uses are let through.
  if (!/^[0-9a-f-]{36}$/.test(guid) || !/^\d+$/.test(drawNum) || !/^\d+$/.test(playerId)) {
    return NextResponse.json({ error: 'tournament must be a GUID; draw and player must be numbers' }, { status: 400 })
  }
  const notFound = (error: string) => NextResponse.json({ error }, { status: 404 })

  const ref = resolveRef(guid)
  if (ref && ref.provider !== 'bat') return notFound('Path is only available for BAT tournaments')

  // The draw list says what kind of draw this is and what it is called. It is
  // read from what is already held; when it is not there, the bracket decides.
  const draws = (await getCachedOrDisk(guid).catch(() => undefined))?.draws ?? []
  const drawInfo = draws.find((d) => d.drawNum === drawNum)
  // A draw number the tournament does not have must not reach BAT.
  if (draws.length > 0 && !drawInfo) return notFound('No such draw')
  if (drawInfo && (drawInfo.groupLetter || (drawInfo.type && !/^elimination$/i.test(drawInfo.type.trim())))) {
    return notFound('Not a knockout draw')
  }

  let html: string | undefined
  try {
    // A finished tournament's brackets live on disk until someone opens one.
    await ensureBracketsLoaded(guid, drawNum)
    // With nothing held and BAT in an outage, fetching would keep the reader
    // waiting on a request that is sure to fail (two 50-second attempts).
    if (!rawHtmlCache.has(makeBracketKey(guid, drawNum)) && batDownSince()) {
      return notFound('No bracket for this draw')
    }
    html = await bracketHtmlForSchedule(guid, drawNum)
  } catch {
    html = undefined
  }
  if (!html) return notFound('No bracket for this draw')

  // A round-robin page parses into rounds too. The draw list usually says so
  // first; when it is not held, the shape of the rounds does.
  const bracketRounds = parseBracketRounds(html)
  if (!isKnockout(bracketRounds)) return notFound('Not a knockout draw')
  const path = buildBracketPath(bracketRounds, playerId)
  if (!path) return notFound('Player is not in this draw')

  // The ranking file is several megabytes and read afresh each time, so it is
  // only opened for a draw that has a ranking event to look positions up in.
  const eventCode = drawInfo ? rankingEventCodeForDraw(drawInfo.name) : null
  const noIds: Record<string, string[]> = {}
  const [index, ranking, rankingIds] = await Promise.all([
    readIndexCache('bat').catch(() => null),
    eventCode ? readRankingCache('bat').catch(() => null) : null,
    eventCode ? readGlobalPlayerIds().catch(() => noIds) : noIds,
  ])
  // The ranking can spell a name differently from the bracket; the curated
  // alias list and the players' ranking ids bridge that.
  const identify = (slug: string) => {
    const aliasSlug = rankingSlugAlias('bat', slug)
    return {
      ...(aliasSlug !== slug && { aliasSlug }),
      ...(rankingIds[slug] && { globalPlayerIds: rankingIds[slug] }),
    }
  }

  const rounds: PathRoundOut[] = path.rounds.map((round) => {
    const { candidates, ...rest } = round
    const out: PathRoundOut = { ...rest }
    if (round.status === 'next' && round.opponent) {
      out.record = pairRecord(index, path.team, round.opponent)
    }
    if (candidates) {
      out.candidates = rankCandidates(candidates.map((c) => {
        const rank = eventCode ? teamRank(ranking, eventCode, c.team, identify) : undefined
        return {
          team: c.team,
          ...(c.seed && { seed: c.seed }),
          ...(rank !== undefined && { rank }),
          record: pairRecord(index, path.team, c.team),
        }
      }))
    }
    return out
  })

  // An overdue bracket is normal — it is being refreshed in the background.
  // It is only worth a warning when BAT is failing, so that refresh cannot land.
  const entry = cache.get(makeBracketKey(guid, drawNum))
  const overdue = !!entry && !entry.done && Date.now() - entry.ts >= ttlMsFor(entry)
  const stale = overdue && !!batDownSince()

  const body: PathResponse = {
    team: path.team,
    ...(path.seed && { seed: path.seed }),
    eliminated: path.eliminated,
    champion: path.champion,
    rounds,
    stale,
  }
  return NextResponse.json(body, stale ? { headers: staleHeaders() } : undefined)
}
