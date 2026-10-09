import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import { hasSent, markSent, pruneSent, loadSentLog, refreshSentLog, __setSentRootForTesting } from '@/lib/push/sent-log'

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'push-sent-'))
  __setSentRootForTesting(tmp)
  await loadSentLog()
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('sent log', () => {
  it('remembers what was marked', async () => {
    expect(hasSent('a')).toBe(false)
    await markSent(['a', 'b'], '2026-10-09')
    expect(hasSent('a')).toBe(true)
    expect(hasSent('b')).toBe(true)
    expect(hasSent('c')).toBe(false)
  })

  it('is read back after a restart', async () => {
    await markSent(['a'], '2026-10-09')
    __setSentRootForTesting(tmp)
    expect(hasSent('a')).toBe(false) // not loaded yet
    await loadSentLog()
    expect(hasSent('a')).toBe(true)
  })

  it('drops days older than yesterday', async () => {
    await markSent(['old'], '2026-10-07')
    await markSent(['yesterday'], '2026-10-08')
    await markSent(['today'], '2026-10-09')
    expect(await pruneSent('2026-10-09')).toBe(1)
    expect(hasSent('old')).toBe(false)
    expect(hasSent('yesterday')).toBe(true)
    expect(hasSent('today')).toBe(true)
  })

  it('starts empty from a corrupt file', async () => {
    await fs.writeFile(path.join(tmp, 'sent.json'), '{nope', 'utf8')
    __setSentRootForTesting(tmp)
    await loadSentLog()
    expect(hasSent('a')).toBe(false)
    await markSent(['a'], '2026-10-09')
    expect(hasSent('a')).toBe(true)
  })

  it('marking nothing writes nothing', async () => {
    await markSent([], '2026-10-09')
    await expect(fs.stat(path.join(tmp, 'sent.json'))).rejects.toBeDefined()
  })
})

describe('sent log shared between two workers', () => {
  const file = () => path.join(tmp, 'sent.json')
  const otherWorkerWrites = async (sent: Record<string, string>) => {
    await fs.writeFile(file(), JSON.stringify({ version: 1, sent }), 'utf8')
    const later = new Date(Date.now() + 5000)
    await fs.utimes(file(), later, later)
  }

  it('picks up what the other worker sent before deciding again', async () => {
    await markSent(['mine'], '2026-10-09')
    await otherWorkerWrites({ mine: '2026-10-09', theirs: '2026-10-09' })
    expect(hasSent('theirs')).toBe(false)
    await refreshSentLog()
    expect(hasSent('theirs')).toBe(true)
    expect(hasSent('mine')).toBe(true)
  })

  it('does not wipe the other worker\'s entries with a stale copy when it next writes', async () => {
    await markSent(['mine'], '2026-10-09')
    await otherWorkerWrites({ theirs: '2026-10-09' })
    await markSent(['more'], '2026-10-09')
    const onDisk = JSON.parse(await fs.readFile(file(), 'utf8')).sent
    expect(Object.keys(onDisk).sort()).toEqual(['mine', 'more', 'theirs'])
  })

  it('refreshing with no file, or an unchanged one, changes nothing', async () => {
    await refreshSentLog()
    await markSent(['a'], '2026-10-09')
    await refreshSentLog()
    expect(hasSent('a')).toBe(true)
  })
})
