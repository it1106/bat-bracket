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
      expect.objectContaining({ id: 'AAAA1111-2222-3333-4444-555555555555', provider: 'bwf', done: false }),
    ]))
  })

  it('returns bat by default for unknown IDs (backward-compat)', () => {
    expect(resolveRef('CCCC3333-2222-3333-4444-555555555555')?.provider).toBe('bat')
  })
})
