import fs from 'fs'
import path from 'path'
import os from 'os'
import { resolveRef, listAllTournaments, _refreshRegistryForTesting } from '@/lib/tournaments-registry'
import { resetSidecarForTesting, saveSidecarEntry } from '@/lib/providers/bwf/sidecar'

describe('tournaments registry', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'))
    fs.mkdirSync(path.join(tmpDir, 'public'))
    resetSidecarForTesting(path.join(tmpDir, 'public', 'bwf-cache.json'))
    saveSidecarEntry('https://bwfbadminton.com/tournament/5726/x/', {
      tmtId: 5726,
      tournamentCode: 'AAAA1111-2222-3333-4444-555555555555',
      slug: 'x', name: 'X', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
    })
    fs.writeFileSync(path.join(tmpDir, 'public', 'tournaments.txt'),
      `BBBB2222-2222-3333-4444-555555555555 BAT Test\n@bwf https://bwfbadminton.com/tournament/5726/x/\n`,
    )
    _refreshRegistryForTesting(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resolves BAT GUID to a bat ref', () => {
    expect(resolveRef('BBBB2222-2222-3333-4444-555555555555')).toEqual({
      id: 'BBBB2222-2222-3333-4444-555555555555', provider: 'bat',
    })
  })

  it('resolves BWF GUID to a bwf ref', () => {
    expect(resolveRef('AAAA1111-2222-3333-4444-555555555555')).toEqual({
      id: 'AAAA1111-2222-3333-4444-555555555555', provider: 'bwf',
    })
  })

  it('lookup is case-insensitive on GUID', () => {
    expect(resolveRef('aaaa1111-2222-3333-4444-555555555555')?.provider).toBe('bwf')
  })

  it('lists all tournaments with provider tags', () => {
    const all = listAllTournaments()
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'BBBB2222-2222-3333-4444-555555555555', provider: 'bat', done: false }),
      // Its end date (24 May 2026) is long past, so it counts as finished.
      expect.objectContaining({ id: 'AAAA1111-2222-3333-4444-555555555555', provider: 'bwf', done: true }),
    ]))
  })

  describe('BWF tournaments finish by their end date', () => {
    const DAY = 24 * 60 * 60_000
    // Calendar day in Bangkok, the way the site counts days.
    const bangkokDay = (t: number) => new Date(t + 7 * 60 * 60_000).toISOString().slice(0, 10)
    const CODE = 'CCCC9999-2222-3333-4444-555555555555'

    function bwfEnding(endDateIso: string, listedInTxt: boolean) {
      const url = 'https://bwfbadminton.com/tournament/9999/y/'
      saveSidecarEntry(url, {
        tmtId: 9999, tournamentCode: CODE, slug: 'y', name: 'Y',
        startDateIso: '2026-01-01', endDateIso, resolvedAt: 'x',
      })
      fs.writeFileSync(path.join(tmpDir, 'public', 'tournaments.txt'), listedInTxt ? `@bwf ${url}\n` : '')
      _refreshRegistryForTesting(tmpDir)
      return listAllTournaments().find((t) => t.id === CODE)
    }

    it.each([true, false])('is still active on its last day and the day after (listed in tournaments.txt: %s)', (listed) => {
      expect(bwfEnding(bangkokDay(Date.now()), listed)?.done).toBe(false)
      expect(bwfEnding(bangkokDay(Date.now() - DAY), listed)?.done).toBe(false)
    })

    it.each([true, false])('is finished two days after its last day (listed in tournaments.txt: %s)', (listed) => {
      expect(bwfEnding(bangkokDay(Date.now() - 2 * DAY), listed)?.done).toBe(true)
    })

    it('is active while it is still to come', () => {
      expect(bwfEnding(bangkokDay(Date.now() + 5 * DAY), false)?.done).toBe(false)
    })

    it('is treated as active when its end date is missing', () => {
      expect(bwfEnding('', false)?.done).toBe(false)
    })
  })

  it('returns bat by default for unknown IDs (backward-compat)', () => {
    expect(resolveRef('CCCC3333-2222-3333-4444-555555555555')?.provider).toBe('bat')
  })
})
