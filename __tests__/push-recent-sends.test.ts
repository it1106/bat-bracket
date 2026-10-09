import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import os from 'os'
import path from 'path'
import {
  MAX_RECENT_SENDS,
  __setRecentSendsRootForTesting,
  listRecentSends,
  loadRecentSends,
  readRecentSends,
  recordSend,
} from '@/lib/push/recent-sends'
import type { RecentSend } from '@/lib/push/recent-sends'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'recent-sends-'))
  __setRecentSendsRootForTesting(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const send = (over: Partial<RecentSend> = {}): RecentSend => ({
  at: '2026-10-09T03:55:04.000Z',
  device: '02533ab321f9a162',
  stage: 'result',
  result: 'ok',
  draw: 'BS U17',
  round: 'Round of 128',
  match: 'ปริญญา พุฒิไพรสกุล [12] v ธนากร วรวาส',
  via: 'ปริญญา พุฒิไพรสกุล',
  ...over,
})

describe('recent sends', () => {
  it('keeps what was sent, newest first', async () => {
    await recordSend(send({ at: '2026-10-09T03:00:00.000Z', match: 'first' }))
    await recordSend(send({ at: '2026-10-09T04:00:00.000Z', match: 'second' }))
    expect(listRecentSends().map((s) => s.match)).toEqual(['second', 'first'])
  })

  it('survives a restart, because a reload must not empty the table', async () => {
    await recordSend(send({ match: 'before the reload' }))
    __setRecentSendsRootForTesting(dir)
    expect(listRecentSends()).toEqual([])
    await loadRecentSends()
    expect(listRecentSends().map((s) => s.match)).toEqual(['before the reload'])
  })

  it('drops the oldest once it is full', async () => {
    for (let i = 0; i < MAX_RECENT_SENDS + 5; i++) {
      await recordSend(send({ at: `2026-10-09T03:00:${String(i).padStart(2, '0')}.000Z`, match: `m${i}` }))
    }
    const rows = listRecentSends()
    expect(rows).toHaveLength(MAX_RECENT_SENDS)
    expect(rows[0].match).toBe(`m${MAX_RECENT_SENDS + 4}`)
    expect(rows.some((r) => r.match === 'm0')).toBe(false)
  })

  it('records a failed send too, so a silent failure is visible', async () => {
    await recordSend(send({ result: 'failed' }))
    expect(listRecentSends()[0].result).toBe('failed')
  })

  it('names the club when a club follow brought the match in', async () => {
    await recordSend(send({ via: 'UNITY&RAWIN', match: 'ชยพัทธ์ รอดแย้ม v ณัฐปภัสร์ ตันติวิริยางกูร' }))
    expect(listRecentSends()[0].via).toBe('UNITY&RAWIN')
  })

  it('starts empty when the file is corrupt rather than breaking the status page', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'recent-sends.json'), '{not json', 'utf8')
    __setRecentSendsRootForTesting(dir)
    await loadRecentSends()
    expect(listRecentSends()).toEqual([])
  })

  it('reads the file for the status page without disturbing what the watcher holds', async () => {
    await recordSend(send({ match: 'on disk' }))
    const fromDisk = await readRecentSends()
    expect(fromDisk.map((r) => r.match)).toEqual(['on disk'])
    // The watcher's own copy is untouched, so a send racing this read cannot
    // lose a row.
    expect(listRecentSends().map((r) => r.match)).toEqual(['on disk'])
  })

  it('gives the status page nothing when the file is corrupt', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'recent-sends.json'), 'broken', 'utf8')
    expect(await readRecentSends()).toEqual([])
  })
})
