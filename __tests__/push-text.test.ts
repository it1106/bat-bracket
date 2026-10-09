import { alertPayload, digestPayload } from '@/lib/push/text'
import type { DueAlert } from '@/lib/push/types'
import type { MatchEntry, MatchPlayer } from '@/lib/types'

const P = (name: string, playerId: string): MatchPlayer => ({ name, playerId })
const TID = 'AAAAAAAA-0000-0000-0000-000000000001'

const match = (over: Partial<MatchEntry> = {}): MatchEntry => ({
  draw: 'BS U15', drawNum: '21', round: 'Round of 32',
  team1: [P('Anan Dee', '1')], team2: [P('Beam Kla', '2')],
  winner: null, scores: [], court: 'Court 4', walkover: false, retired: false, nowPlaying: false,
  ...over,
})

const alert = (over: Partial<DueAlert> = {}): DueAlert => {
  const m = over.match ?? match()
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/x', lang: 'en', stage: 'next', position: 1,
    sentKey: 'k', covers: ['k'], match: m, players: [m.team1[0]], clubs: [], ...over,
  }
}

describe('alertPayload', () => {
  it('says "Up next" with the player first, the opponent, the draw, round and court', () => {
    const p = alertPayload(alert(), TID)
    expect(p.title).toBe('Up next')
    expect(p.body).toBe('Anan Dee vs Beam Kla · BS U15 R32 · Court 4')
    expect(p.url).toBe(`/?tournament=${TID}`)
  })

  it('puts the followed side first even when it is listed second', () => {
    const m = match()
    expect(alertPayload(alert({ match: m, players: [m.team2[0]] }), TID).body)
      .toBe('Beam Kla vs Anan Dee · BS U15 R32 · Court 4')
  })

  it('counts how far away the early alert is from the queue position', () => {
    expect(alertPayload(alert({ stage: 'soon', position: 4 }), TID).title).toBe('About 3 matches away')
    expect(alertPayload(alert({ stage: 'soon', position: 3 }), TID).title).toBe('About 2 matches away')
    expect(alertPayload(alert({ stage: 'soon', position: 2 }), TID).title).toBe('About 1 match away')
  })

  it('leaves the court out when the schedule has none', () => {
    expect(alertPayload(alert({ match: match({ court: '' }) }), TID).body).toBe('Anan Dee vs Beam Kla · BS U15 R32')
  })

  it('names both partners of a doubles pair', () => {
    const m = match({ draw: 'BD U15', team1: [P('Anan Dee', '1'), P('Krit Wong', '9')], team2: [P('Beam Kla', '2'), P('Chai Yo', '3')] })
    expect(alertPayload(alert({ match: m, players: [m.team1[1]] }), TID).body)
      .toBe('Anan Dee / Krit Wong vs Beam Kla / Chai Yo · BD U15 R32 · Court 4')
  })

  it('keeps the page order when both sides are followed', () => {
    const m = match()
    expect(alertPayload(alert({ match: m, players: [m.team2[0], m.team1[0]] }), TID).body)
      .toBe('Anan Dee vs Beam Kla · BS U15 R32 · Court 4')
  })

  it('is written in Thai for a Thai device', () => {
    expect(alertPayload(alert({ lang: 'th' }), TID).title).toBe('คู่ต่อไป')
    expect(alertPayload(alert({ lang: 'th', stage: 'soon', position: 4 }), TID).title).toBe('อีกประมาณ 3 คู่')
    expect(alertPayload(alert({ lang: 'th' }), TID).body).toContain(' พบ ')
  })

  it('uses one tag per match, so "next" replaces "soon" on the device', () => {
    const soon = alertPayload(alert({ stage: 'soon', position: 3 }), TID)
    const next = alertPayload(alert({ stage: 'next' }), TID)
    expect(soon.tag).toBe(next.tag)
    expect(alertPayload(alert({ match: match({ drawNum: '22' }) }), TID).tag).not.toBe(next.tag)
  })
})

describe('digestPayload', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) =>
    alert({
      position: n - i, stage: n - i === 1 ? 'next' : 'soon',
      match: match({ team1: [P(`Player ${i}`, String(100 + i))], court: `Court ${i}` }),
    }))

  it('counts the matches and lists the nearest first', () => {
    const p = digestPayload(many(3), TID, '2026-10-09T10:15')
    expect(p.title).toBe('3 matches coming up')
    expect(p.body.split('\n')).toEqual([
      'Player 2 · BS U15 · Court 2',
      'Player 1 · BS U15 · Court 1',
      'Player 0 · BS U15 · Court 0',
    ])
  })

  it('lists four and counts the rest', () => {
    const lines = digestPayload(many(7), TID, '2026-10-09T10:15').body.split('\n')
    expect(lines).toHaveLength(5)
    expect(lines[4]).toBe('+3 more')
  })

  it('lists exactly four without a remainder line', () => {
    expect(digestPayload(many(4), TID, '2026-10-09T10:15').body.split('\n')).toHaveLength(4)
  })

  it('is written in the first alert\'s language', () => {
    const th = many(7).map((a) => ({ ...a, lang: 'th' as const }))
    const p = digestPayload(th, TID, '2026-10-09T10:15')
    expect(p.title).toBe('อีก 7 คู่ใกล้ถึงคิว')
    expect(p.body.split('\n')[4]).toBe('+อีก 3 คู่')
  })

  it('has a tag of its own, per tournament and minute', () => {
    const p = digestPayload(many(3), TID, '2026-10-09T10:15')
    expect(p.tag).toBe(`${TID}|2026-10-09T10:15`)
    expect(p.url).toBe(`/?tournament=${TID}`)
  })
})
