import { buildIndex } from '@/lib/playerIndex'

describe('buildIndex — empty input', () => {
  it('returns an empty index with zero players and zero matches', () => {
    const { index, leaderboards } = buildIndex('bat', [])
    expect(index.totalPlayers).toBe(0)
    expect(index.totalMatches).toBe(0)
    expect(index.players).toEqual({})
    expect(index.sources).toEqual([])
    expect(leaderboards.boards.length).toBe(14)
    for (const b of leaderboards.boards) expect(b.entries).toEqual([])
  })
})
