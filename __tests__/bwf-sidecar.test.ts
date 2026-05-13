import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  loadSidecar,
  saveSidecarEntry,
  lookupByGuid,
  lookupByUrl,
  resetSidecarForTesting,
} from '@/lib/providers/bwf/sidecar'

describe('bwf sidecar', () => {
  let tmpDir: string
  let tmpFile: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwf-sidecar-'))
    tmpFile = path.join(tmpDir, 'bwf-cache.json')
    resetSidecarForTesting(tmpFile)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads empty when file missing', () => {
    expect(loadSidecar()).toEqual({})
  })

  it('writes and reads back an entry', () => {
    saveSidecarEntry('https://example/x', {
      tmtId: 5726,
      tournamentCode: 'AAAA1111-2222-3333-4444-555555555555',
      slug: 'x',
      name: 'X',
      startDateIso: '2026-05-19',
      endDateIso: '2026-05-24',
      resolvedAt: '2026-05-13T00:00:00Z',
    })
    expect(lookupByUrl('https://example/x')?.tmtId).toBe(5726)
    expect(lookupByGuid('AAAA1111-2222-3333-4444-555555555555')?.slug).toBe('x')
  })

  it('lookupByGuid is case-insensitive', () => {
    saveSidecarEntry('https://example/y', {
      tmtId: 1, tournamentCode: 'BBBB2222-2222-3333-4444-555555555555',
      slug: 'y', name: 'Y', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
    })
    expect(lookupByGuid('bbbb2222-2222-3333-4444-555555555555')).toBeTruthy()
  })

  it('returns empty object on corrupt JSON', () => {
    fs.writeFileSync(tmpFile, 'not json {{{')
    expect(loadSidecar()).toEqual({})
  })

  it('persists across instances', () => {
    saveSidecarEntry('https://example/z', {
      tmtId: 1, tournamentCode: 'CCCC3333-2222-3333-4444-555555555555',
      slug: 'z', name: 'Z', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
    })
    resetSidecarForTesting(tmpFile)
    expect(lookupByUrl('https://example/z')?.tmtId).toBe(1)
  })
})
