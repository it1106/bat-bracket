import fs from 'fs'
import os from 'os'
import path from 'path'
import { readClubsCache, writeClubsCache, __setClubsRootForTesting } from '@/lib/clubs-cache'

describe('clubs-cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clubs-cache-'))
    __setClubsRootForTesting(dir)
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when file is missing', async () => {
    expect(await readClubsCache('NONE')).toBeNull()
  })

  it('writes and reads back a club map', async () => {
    await writeClubsCache('ABCD', { '1': 'Bangkok BC', '2': 'Hat Yai BC' })
    expect(await readClubsCache('ABCD')).toEqual({ '1': 'Bangkok BC', '2': 'Hat Yai BC' })
  })

  it('safe-segments tournament IDs', async () => {
    await writeClubsCache('a/b\\c', { x: 'y' })
    const files = fs.readdirSync(dir)
    expect(files.some(f => f.includes('_'))).toBe(true)
  })
})
