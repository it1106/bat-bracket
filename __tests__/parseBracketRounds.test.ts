import fs from 'fs'
import path from 'path'
import { parseBracketRounds } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

const SEED_2_ID = '3417' // ภูมิพิพัชญ์ พึ่งโพธิ์สภ [2]

describe('parseBracketRounds', () => {
  it('returns [] when there is no bracket markup', () => {
    expect(parseBracketRounds('<html><body>nope</body></html>')).toEqual([])
  })

  it('returns every round with its name, halving in size', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    expect(rounds.map((r) => r.name)).toEqual([
      'Round of 128', 'Round of 64', 'Round of 32', 'Round of 16',
      'Quarter final', 'Semi final', 'Final',
    ])
    expect(rounds.map((r) => r.matches.length)).toEqual([64, 32, 16, 8, 4, 2, 1])
  })

  it('keeps both rows of every match, empty or not', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    for (const r of rounds) for (const m of r.matches) {
      expect(m.teams).toHaveLength(2)
      expect(m.seeds).toHaveLength(2)
    }
    // The final has nobody in it yet.
    expect(rounds[6].matches[0].teams).toEqual([[], []])
  })

  it('reads a bye as a decided match with an empty losing row', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    const decided = rounds[0].matches.filter((m) => m.winner !== null)
    expect(decided).toHaveLength(19)
    for (const m of decided) {
      const w = m.winner! - 1
      expect(m.teams[w].length).toBeGreaterThan(0)
      expect(m.teams[1 - w]).toEqual([])
      expect(m.scores).toEqual([])
    }
  })

  it('lifts the seed off the name', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    const all = rounds.flatMap((r) => r.matches)
    const hits = all.flatMap((m) => m.teams.map((team, side) => ({ team, seed: m.seeds[side] })))
      .filter((x) => x.team.some((p) => p.playerId === SEED_2_ID))
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) {
      expect(h.seed).toBe('2')
      expect(h.team[0].name).not.toMatch(/\[/)
    }
    for (const m of all) for (const team of m.teams) for (const p of team) {
      expect(p.name).not.toMatch(/\[[^\]]*\]\s*$/)
      expect(p.playerId).not.toBe('')
    }
  })

  it('places each next-round player on the row its feeder match points at', () => {
    for (const f of ['bracket-bat-ysb-bsu13.html', 'bracket-bat-bsu9.html', 'bracket-bat-themall-bdu17.html']) {
      const rounds = parseBracketRounds(fixtureHtml(f))
      let checked = 0
      rounds[1].matches.forEach((m, i) => {
        m.teams.forEach((team, side) => {
          if (team.length === 0) return
          const feeder = rounds[0].matches[2 * i + side]
          const feederIds = feeder.teams.flat().map((p) => p.playerId)
          for (const p of team) expect(feederIds).toContain(p.playerId)
          checked++
        })
      })
      expect(checked).toBeGreaterThan(0)
    }
  })

  it('reads the schedule and venue from the footer', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    const m = rounds[1].matches.find((x) => x.teams.flat().some((p) => p.playerId === SEED_2_ID))!
    expect(m.date).toBe('20/6/2569')
    expect(m.time).toBe('12:00')
    expect(m.court).toBe('Green Hall')
  })

  it('reads doubles teams and their scores', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-themall-bdu17.html'))
    const played = rounds[0].matches.filter((m) => m.winner !== null && m.teams[0].length > 0 && m.teams[1].length > 0)
    expect(played.length).toBeGreaterThan(0)
    for (const m of played) {
      expect(m.teams[0]).toHaveLength(2)
      expect(m.teams[1]).toHaveLength(2)
      expect(m.scores.length).toBeGreaterThanOrEqual(2)
      expect(m.scores[0].t1 + m.scores[0].t2).toBeGreaterThan(0)
    }
  })

  it('returns empty rows for a draw published with no entrants', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-unentered.html'))
    expect(rounds.map((r) => r.matches.length)).toEqual([8, 4, 2, 1])
    expect(rounds.flatMap((r) => r.matches).every((m) => m.teams[0].length === 0 && m.teams[1].length === 0)).toBe(true)
  })

describe('parseBracketRounds on a finished real draw', () => {
  const rounds = parseBracketRounds(fixtureHtml('bracket-bat-finished-16.html'))

  it('finds every match decided, down to the final', () => {
    expect(rounds.map((r) => r.matches.length)).toEqual([8, 4, 2, 1])
    expect(rounds.flatMap((r) => r.matches).every((m) => m.winner !== null)).toBe(true)
    const final = rounds[3].matches[0]
    expect(final.teams.map((t) => t[0].playerId)).toEqual(['1666', '1862'])
    expect(final.winner).toBe(2)
  })

  it('puts every winner on the row of the next round that its match feeds', () => {
    let checked = 0
    for (let r = 0; r < rounds.length - 1; r++) {
      rounds[r].matches.forEach((m, j) => {
        const winner = m.teams[m.winner! - 1]
        const next = rounds[r + 1].matches[Math.floor(j / 2)].teams[j % 2]
        expect(next.map((p) => p.playerId)).toEqual(winner.map((p) => p.playerId))
        checked++
      })
    }
    expect(checked).toBe(14)
  })

  it('flags the walkover and gives it no score', () => {
    const wo = rounds[1].matches[1]
    expect(wo.walkover).toBe(true)
    expect(wo.scores).toEqual([])
    expect(wo.winner).toBe(2)
    expect(rounds.flatMap((r) => r.matches).filter((m) => m.walkover)).toHaveLength(1)
  })
})
})
