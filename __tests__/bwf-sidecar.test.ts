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
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    fs.writeFileSync(tmpFile, 'not json {{{')
    expect(loadSidecar()).toEqual({})
    warn.mockRestore()
  })

  // A reader that catches the file mid-write used to cache that empty result
  // for the life of the worker: every BWF tournament then looked like a BAT
  // one, so its players were scraped from BAT and its events vanished from
  // the tournament list until the process restarted.
  it('does not remember a bad read once the file is whole again', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    fs.writeFileSync(tmpFile, '{"https://example/x": {"tmtId": 57')
    expect(loadSidecar()).toEqual({})

    fs.writeFileSync(tmpFile, JSON.stringify({
      'https://example/x': {
        tmtId: 5777, tournamentCode: 'DDDD4444-2222-3333-4444-555555555555',
        slug: 'x', name: 'X', startDateIso: '2026-11-03', endDateIso: '2026-11-08', resolvedAt: 'x',
      },
    }))

    expect(lookupByGuid('DDDD4444-2222-3333-4444-555555555555')?.tmtId).toBe(5777)
    warn.mockRestore()
  })

  // A file that simply isn't there is a settled fact, not a transient one, so
  // it must not cost a read on every lookup.
  it('reads the disk once when there is no file', () => {
    const read = jest.spyOn(fs, 'readFileSync')
    loadSidecar()
    loadSidecar()
    loadSidecar()
    expect(read).toHaveBeenCalledTimes(1)
    read.mockRestore()
  })

  // Writing in place is what let a reader see a half-file. Renaming a
  // complete temp file over it means a reader gets the old one or the new
  // one, never a fragment.
  it('puts a whole file in place rather than writing over the live one', () => {
    const rename = jest.spyOn(fs, 'renameSync')
    saveSidecarEntry('https://example/atomic', {
      tmtId: 9, tournamentCode: 'EEEE5555-2222-3333-4444-555555555555',
      slug: 'a', name: 'A', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
    })

    expect(rename).toHaveBeenCalledWith(expect.stringContaining(tmpFile), tmpFile)
    expect(fs.readdirSync(tmpDir)).toEqual(['bwf-cache.json'])
    expect(JSON.parse(fs.readFileSync(tmpFile, 'utf-8'))['https://example/atomic'].tmtId).toBe(9)
    rename.mockRestore()
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
