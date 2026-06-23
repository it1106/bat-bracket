import {
  pointsFor, levelTable, ageGroupFromEvent, pointsRoundFromResult,
  AGE_GROUPS, POINTS_ROUNDS,
  type AgeGroup,
} from '@/lib/points/bat-points'

// Published 2563 grid transcribed from the official tables.
// rows order: Winner, Runner-Up, SF(3/4), QF(5/8), R9/16, R17/32, R33/64
const PUBLISHED: Record<number, Record<AgeGroup, number[]>> = {
  1: { Open:[40000,32000,25600,20480,16384,13107,10486], U19:[25000,20000,16000,12800,10240,8192,6554], U17:[16000,12800,10240,8192,6554,5243,4194], U15:[10240,8192,6554,5243,4194,3355,2684], U13:[6554,5243,4194,3355,2684,2147,1718], U11:[4194,3355,2684,2147,1718,1374,1100], U9:[2684,2147,1718,1374,1100,880,704] },
  2: { Open:[32000,25600,20480,16384,13107,10486,8389], U19:[20000,16000,12800,10240,8192,6554,5243], U17:[12800,10240,8192,6554,5243,4194,3355], U15:[8192,6554,5243,4194,3355,2684,2147], U13:[5243,4194,3355,2684,2147,1718,1374], U11:[3355,2684,2147,1718,1374,1100,880], U9:[2147,1718,1374,1100,880,704,563] },
  3: { Open:[25600,20480,16384,13107,10486,8389,6711], U19:[16000,12800,10240,8192,6554,5243,4194], U17:[10240,8192,6554,5243,4194,3355,2684], U15:[6554,5243,4194,3355,2684,2147,1718], U13:[4194,3355,2684,2147,1718,1374,1100], U11:[2684,2147,1718,1374,1100,880,704], U9:[1718,1374,1100,880,704,563,450] },
  4: { Open:[20480,16384,13107,10486,8389,6711,5369], U19:[12800,10240,8192,6554,5243,4194,3355], U17:[8192,6554,5243,4194,3355,2684,2147], U15:[5243,4194,3355,2684,2147,1718,1374], U13:[3355,2684,2147,1718,1374,1100,880], U11:[2147,1718,1374,1100,880,704,563], U9:[1374,1100,880,704,563,450,360] },
  5: { Open:[16384,13107,10486,8389,6711,5369,4295], U19:[10240,8192,6554,5243,4194,3355,2684], U17:[6554,5243,4194,3355,2684,2147,1718], U15:[4194,3355,2684,2147,1718,1374,1100], U13:[2684,2147,1718,1374,1100,880,704], U11:[1718,1374,1100,880,704,563,450], U9:[1100,880,704,563,450,360,288] },
  6: { Open:[13107,10486,8389,6711,5369,4295,3436], U19:[8192,6554,5243,4194,3355,2684,2147], U17:[5243,4194,3355,2684,2147,1718,1374], U15:[3355,2684,2147,1718,1374,1100,880], U13:[2147,1718,1374,1100,880,704,563], U11:[1374,1100,880,704,563,450,360], U9:[880,704,563,450,360,288,231] },
}

describe('bat-points formula', () => {
  it('reproduces every published cell exactly', () => {
    for (let level = 1; level <= 6; level++) {
      for (const age of AGE_GROUPS) {
        POINTS_ROUNDS.forEach((round, i) => {
          expect(pointsFor(level, age, round)).toBe(PUBLISHED[level][age][i])
        })
      }
    }
  })

  it('levelTable returns the full grid for a level', () => {
    expect(levelTable(2)).toEqual(PUBLISHED[2])
  })
})

describe('ageGroupFromEvent', () => {
  it('parses U-age events', () => {
    expect(ageGroupFromEvent('BS U15')).toBe('U15')
    expect(ageGroupFromEvent('XD U19')).toBe('U19')
    expect(ageGroupFromEvent("Boy's singles U9")).toBe('U9')
  })
  it('treats events without a U-age as Open', () => {
    expect(ageGroupFromEvent('MS')).toBe('Open')
    expect(ageGroupFromEvent('XD')).toBe('Open')
  })
  it('returns null for U-ages outside the table', () => {
    expect(ageGroupFromEvent('XD U23')).toBeNull()
    expect(ageGroupFromEvent('BS U7')).toBeNull()
  })
})

describe('pointsRoundFromResult', () => {
  it('returns Winner for a champion regardless of wins/drawSize', () => {
    expect(pointsRoundFromResult('Champion', 4, 32)).toBe('Winner')
  })
  it('uses the actual exit round once the player has won a match', () => {
    expect(pointsRoundFromResult('F', 3, 32)).toBe('RunnerUp')   // bye'd finalist not demoted
    expect(pointsRoundFromResult('QF', 1, 32)).toBe('QF')        // bye'd quarterfinalist not demoted
    expect(pointsRoundFromResult('R16', 1, 32)).toBe('R16')      // normal R16 loser (won R32)
  })
  it('credits a 0-win player as a first-round loss from drawSize', () => {
    expect(pointsRoundFromResult('R16', 0, 32)).toBe('R32')      // bye into R16 then lost, 32-draw
    expect(pointsRoundFromResult('R16', 0, 16)).toBe('R16')      // genuine first-round loss in a 16-draw
    expect(pointsRoundFromResult('R32', 0, 64)).toBe('R64')      // two byes then lost, 64-draw
  })
  it('returns null when a row cannot be determined', () => {
    expect(pointsRoundFromResult('R16', 0, undefined)).toBeNull() // 0 wins, drawSize missing
    expect(pointsRoundFromResult('R128', 1, 128)).toBeNull()      // off table
    expect(pointsRoundFromResult('RR', 1, undefined)).toBeNull()  // group-only
  })
})
