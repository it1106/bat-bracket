import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import { readLastGoodDay, writeLastGoodDay, readLastGoodFull, writeLastGoodFull } from '@/lib/schedule-last-good'
import type { MatchesData } from '@/lib/types'

const T = 'AAAAAAAA-0000-0000-0000-000000000001'
let tmp = ''
let cwd = ''

beforeEach(async () => {
  cwd = process.cwd()
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'last-good-')))
  process.chdir(tmp)
})
afterEach(async () => {
  process.chdir(cwd)
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('last good schedule on disk', () => {
  const day = { groups: [{ type: 'time' as const, time: '09:00', matches: [] }] }
  const full = { days: [], currentDate: '25691005', groups: [] } as unknown as MatchesData

  it('gives back the day and the full schedule it was given, in any letter case', async () => {
    await writeLastGoodDay(T, '2026-10-05', day)
    await writeLastGoodFull(T, full)
    expect(await readLastGoodDay(T.toLowerCase(), '2026-10-05')).toEqual(day)
    expect(await readLastGoodFull(T.toLowerCase())).toEqual(full)
  })

  it('has nothing for a day or tournament it was never given', async () => {
    await writeLastGoodDay(T, '2026-10-05', day)
    expect(await readLastGoodDay(T, '2026-10-06')).toBeNull()
    expect(await readLastGoodFull(T)).toBeNull()
    expect(await readLastGoodDay('OTHER', '2026-10-05')).toBeNull()
  })

  it('keeps the newer answer', async () => {
    await writeLastGoodDay(T, '2026-10-05', day)
    await writeLastGoodDay(T, '2026-10-05', { groups: [] })
    expect(await readLastGoodDay(T, '2026-10-05')).toEqual({ groups: [] })
  })

  it('ignores a file that is not a schedule', async () => {
    const dir = path.join(tmp, '.cache', 'last-good', T.toLowerCase())
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, '2026-10-05.json'), '{"nope":1}')
    await fs.writeFile(path.join(dir, 'full.json'), 'not json')
    expect(await readLastGoodDay(T, '2026-10-05')).toBeNull()
    expect(await readLastGoodFull(T)).toBeNull()
  })
})
