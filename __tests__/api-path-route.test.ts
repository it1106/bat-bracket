import fs from 'fs'
import nodePath from 'path'

jest.mock('../lib/bracket-cache', () => ({
  cache: new Map(),
  ttlMsFor: () => 30 * 60_000,
  makeBracketKey: (guid: string, drawNum: string) => `${guid.toLowerCase()}:${drawNum}`,
  bracketHtmlForSchedule: jest.fn(),
  ensureBracketsLoaded: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/player-index-cache', () => ({ readIndexCache: jest.fn().mockResolvedValue(null) }))
jest.mock('../lib/ranking/cache', () => ({ readRankingCache: jest.fn().mockResolvedValue(null) }))
jest.mock('../lib/draws-cache', () => ({ getCachedOrDisk: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../lib/tournaments-registry', () => ({ resolveRef: jest.fn().mockReturnValue(undefined) }))
jest.mock('../lib/stale-headers', () => ({
  staleHeaders: () => ({ 'Cache-Control': 'no-store', 'X-Stale-Cache': '1' }),
}))
jest.mock('../lib/bat-outages', () => ({ batDownSince: jest.fn().mockReturnValue(null) }))

import { GET } from '@/app/api/path/route'
import { cache, bracketHtmlForSchedule, ensureBracketsLoaded } from '@/lib/bracket-cache'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { getCachedOrDisk } from '@/lib/draws-cache'
import { resolveRef } from '@/lib/tournaments-registry'
import { batDownSince } from '@/lib/bat-outages'
import { parseBracketRounds } from '@/lib/scraper'
import { nameToSlug } from '@/lib/playerIndex'
import { seedNumber, type PathResponse } from '@/lib/pathEnrich'

const HTML = fs.readFileSync(nodePath.join(process.cwd(), 'fixtures', 'bracket-bat-bsu9.html'), 'utf-8')
const TID = 'aaaaaaaa-0000-0000-0000-000000000001'

const htmlMock = bracketHtmlForSchedule as jest.Mock
const indexMock = readIndexCache as jest.Mock
const rankingMock = readRankingCache as jest.Mock
const drawsMock = getCachedOrDisk as jest.Mock
const refMock = resolveRef as jest.Mock
const downMock = batDownSince as jest.Mock

// A first-round match with two players and no result yet.
const ROUNDS = parseBracketRounds(HTML)
const OPEN = ROUNDS[0].matches.find((m) => m.winner === null && m.teams[0].length > 0 && m.teams[1].length > 0)!
const PLAYER = OPEN.teams[0][0]
const OPPONENT = OPEN.teams[1][0]

const get = (qs: string) => GET(new Request(`http://x/api/path?${qs}`))
const ok = () => get(`tournament=${TID}&draw=5&player=${PLAYER.playerId}`)

beforeEach(() => {
  ;(cache as Map<string, unknown>).clear()
  htmlMock.mockReset().mockResolvedValue(HTML)
  indexMock.mockReset().mockResolvedValue(null)
  rankingMock.mockReset().mockResolvedValue(null)
  drawsMock.mockReset().mockResolvedValue(undefined)
  refMock.mockReset().mockReturnValue(undefined)
  downMock.mockReset().mockReturnValue(null)
  ;(ensureBracketsLoaded as jest.Mock).mockClear()
})

describe('GET /api/path', () => {
  it('needs all three params', async () => {
    for (const qs of ['', `tournament=${TID}&draw=5`, `tournament=${TID}&player=1`, 'draw=5&player=1']) {
      expect((await get(qs)).status).toBe(400)
    }
  })

  it('is 404 for a player who is not in the draw', async () => {
    expect((await get(`tournament=${TID}&draw=5&player=999999`)).status).toBe(404)
  })

  it('is 404 when there is no bracket', async () => {
    htmlMock.mockResolvedValue(undefined)
    expect((await ok()).status).toBe(404)
  })

  it('is 404 when the bracket cannot be fetched', async () => {
    htmlMock.mockRejectedValue(new Error('HTTP 500'))
    expect((await ok()).status).toBe(404)
  })

  it('is 404 for a BWF tournament, without touching the bracket', async () => {
    refMock.mockReturnValue({ id: TID, provider: 'bwf' })
    expect((await ok()).status).toBe(404)
    expect(htmlMock).not.toHaveBeenCalled()
  })

  it('is 404 for a round-robin or grouped draw', async () => {
    drawsMock.mockResolvedValue({ draws: [{ drawNum: '5', name: 'BS U9', size: '4', type: 'Round Robin' }], ts: 0 })
    expect((await ok()).status).toBe(404)
    drawsMock.mockResolvedValue({ draws: [{ drawNum: '5', name: 'BS U9 - Group A', size: '4', type: 'Elimination', groupLetter: 'A' }], ts: 0 })
    expect((await ok()).status).toBe(404)
    expect(htmlMock).not.toHaveBeenCalled()
  })

  it('is 404 for a draw number the tournament does not have, without asking BAT', async () => {
    drawsMock.mockResolvedValue({ draws: [{ drawNum: '6', name: 'GS U9', size: '32', type: 'Elimination' }], ts: 0 })
    expect((await ok()).status).toBe(404)
    expect(htmlMock).not.toHaveBeenCalled()
  })

  it('still reads the bracket when the draw list is held but empty', async () => {
    drawsMock.mockResolvedValue({ draws: [], ts: 0 })
    expect((await ok()).status).toBe(200)
  })

  it('loads a finished tournament from disk before reading the bracket', async () => {
    await ok()
    expect(ensureBracketsLoaded).toHaveBeenCalledWith(TID, '5')
  })

  it('returns the route with the next opponent and ranked candidates', async () => {
    const res = await ok()
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Stale-Cache')).toBeNull()
    const body = (await res.json()) as PathResponse
    expect(body.team[0].playerId).toBe(PLAYER.playerId)
    expect(body.eliminated).toBe(false)
    expect(body.champion).toBe(false)
    expect(body.stale).toBe(false)
    expect(body.rounds.map((r) => r.round)).toEqual(ROUNDS.map((r) => r.name))

    const first = body.rounds[0]
    expect(first.status).toBe('next')
    expect(first.opponent![0].playerId).toBe(OPPONENT.playerId)
    expect(first.record).toBeNull()

    const final = body.rounds[body.rounds.length - 1]
    expect(final.status).toBe('future')
    expect(final.candidates!.length).toBeGreaterThan(4)
    // The far half of a seeded draw holds seed 1 or seed 2: that is the favourite.
    const seeds = final.candidates!.map((c) => seedNumber(c.seed)).filter((s): s is number => s !== undefined)
    expect(final.candidates![0].favourite).toBe(true)
    expect(seedNumber(final.candidates![0].seed)).toBe(Math.min(...seeds))
    expect(final.candidates!.filter((c) => c.favourite)).toHaveLength(1)
    expect(final.candidates!.every((c) => c.record === null)).toBe(true)
  })

  it('adds the past record from the player index', async () => {
    indexMock.mockResolvedValue({
      players: {
        [nameToSlug(PLAYER.name)]: {
          tournamentMatches: {
            't:e': [
              { round: 'QF', partners: [], opponents: [OPPONENT.name], scores: [], outcome: 'W' },
              { round: 'SF', partners: [], opponents: [OPPONENT.name], scores: [], outcome: 'L' },
            ],
          },
        },
      },
    })
    const body = (await (await ok()).json()) as PathResponse
    expect(body.rounds[0].record).toEqual({ wins: 1, losses: 1 })
    const final = body.rounds[body.rounds.length - 1]
    expect(final.candidates!.every((c) => c.record && c.record.wins === 0 && c.record.losses === 0)).toBe(true)
  })

  it('adds ranking positions when the draw maps to a ranking event', async () => {
    const semi = (await (await ok()).json() as PathResponse).rounds.find((r) => r.candidates && r.candidates.length >= 2)!
    const target = semi.candidates![1].team[0]
    drawsMock.mockResolvedValue({ draws: [{ drawNum: '5', name: 'BS U9', size: '32', type: 'Elimination' }], ts: 0 })
    rankingMock.mockResolvedValue({
      events: [{ eventCode: 'U9_MS', eventName: 'U9 Boys singles', entries: [{ rank: 4, name: target.name, slug: nameToSlug(target.name) }] }],
    })
    const body = (await (await ok()).json()) as PathResponse
    const all = body.rounds.flatMap((r) => r.candidates ?? [])
    const hit = all.filter((c) => c.team[0].playerId === target.playerId)
    expect(hit.length).toBeGreaterThan(0)
    for (const c of hit) expect(c.rank).toBe(4)
  })

  it('still answers when the index and ranking reads fail', async () => {
    indexMock.mockRejectedValue(new Error('ENOENT'))
    rankingMock.mockRejectedValue(new Error('ENOENT'))
    const res = await ok()
    expect(res.status).toBe(200)
    expect(((await res.json()) as PathResponse).rounds[0].record).toBeNull()
  })

  it('marks an overdue bracket as stale while BAT is down', async () => {
    downMock.mockReturnValue('2026-10-09T03:00:00.000Z')
    ;(cache as Map<string, unknown>).set(`${TID}:5`, { bracket: { html: '' }, ts: Date.now() - 60 * 60_000 })
    const res = await ok()
    expect(res.headers.get('X-Stale-Cache')).toBe('1')
    expect(((await res.json()) as PathResponse).stale).toBe(true)
  })

  it('does not raise the alarm for an overdue bracket while BAT is up', async () => {
    // Overdue only means a background refresh is on its way.
    ;(cache as Map<string, unknown>).set(`${TID}:5`, { bracket: { html: '' }, ts: Date.now() - 60 * 60_000 })
    const res = await ok()
    expect(res.headers.get('X-Stale-Cache')).toBeNull()
    expect(((await res.json()) as PathResponse).stale).toBe(false)
  })

  it('does not call a fresh or finished bracket stale, even while BAT is down', async () => {
    downMock.mockReturnValue('2026-10-09T03:00:00.000Z')
    ;(cache as Map<string, unknown>).set(`${TID}:5`, { bracket: { html: '' }, ts: Date.now() - 60_000 })
    expect(((await (await ok()).json()) as PathResponse).stale).toBe(false)
    ;(cache as Map<string, unknown>).set(`${TID}:5`, { bracket: { html: '' }, ts: 0, done: true })
    expect(((await (await ok()).json()) as PathResponse).stale).toBe(false)
  })
})
