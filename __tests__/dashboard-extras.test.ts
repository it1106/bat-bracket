import { mkdtempSync, rmSync, readdirSync } from 'fs'
import os from 'os'
import path from 'path'
import { DailyHistory, loadDailyHistory, saveDailyHistory } from '@/lib/daily-history'
import { LatencyWindow } from '@/lib/bat-latency'
import { parseRestarts } from '@/lib/pm2-restarts'

describe('DailyHistory', () => {
  it('keeps the highest value reported for each figure of a day', () => {
    const h = new DailyHistory()
    h.note('2026-10-03', 'users', 10)
    h.note('2026-10-03', 'users', 25)
    h.note('2026-10-03', 'users', 20)
    h.note('2026-10-03', 'bat', 300)
    expect(h.rows(30)).toEqual([{ day: '2026-10-03', users: 25, bat: 300 }])
  })

  it('lists the most recent days first and only as many as asked for', () => {
    const h = new DailyHistory()
    for (const d of ['2026-10-01', '2026-10-03', '2026-10-02']) h.note(d, 'pages', 1)
    expect(h.rows(2).map((r) => r.day)).toEqual(['2026-10-03', '2026-10-02'])
  })

  it('forgets days older than it is asked to keep', () => {
    const h = new DailyHistory(2)
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) h.note(d, 'pages', 1)
    expect(h.rows(30).map((r) => r.day)).toEqual(['2026-10-03', '2026-10-02'])
  })

  it('survives a restart, keeping the higher value where both sides have one', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'history-'))
    const file = path.join(dir, 'nested', 'daily-history.json')
    const before = new DailyHistory()
    before.note('2026-10-02', 'users', 74)
    before.note('2026-10-03', 'users', 400)
    saveDailyHistory(before, file)

    const after = new DailyHistory()
    after.note('2026-10-03', 'users', 431)
    loadDailyHistory(after, file)
    expect(after.rows(30)).toEqual([
      { day: '2026-10-03', users: 431 },
      { day: '2026-10-02', users: 74 },
    ])
    expect(readdirSync(path.dirname(file))).toEqual(['daily-history.json'])
    loadDailyHistory(after, path.join(dir, 'missing.json')) // no file: no change, no throw
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('LatencyWindow', () => {
  const NOW = Date.UTC(2026, 9, 4, 3, 0, 0)

  it('reports the typical and slow end of the past hour', () => {
    const w = new LatencyWindow()
    for (let i = 1; i <= 100; i++) w.add(i * 100, NOW) // 100ms … 10,000ms
    expect(w.stats(NOW)).toEqual({ count: 100, medianMs: 5000, p95Ms: 9500, maxMs: 10000, slow: 50 })
  })

  it('forgets requests older than an hour', () => {
    const w = new LatencyWindow()
    w.add(9000, NOW - 61 * 60_000)
    w.add(200, NOW)
    expect(w.stats(NOW)).toEqual({ count: 1, medianMs: 200, p95Ms: 200, maxMs: 200, slow: 0 })
  })

  it('reports nothing when there were no requests', () => {
    expect(new LatencyWindow().stats(NOW)).toEqual({ count: 0, medianMs: null, p95Ms: null, maxMs: null, slow: 0 })
  })

  it('holds a bounded number of samples', () => {
    const w = new LatencyWindow(3)
    for (const ms of [1, 2, 3, 4, 5]) w.add(ms, NOW)
    expect(w.stats(NOW)).toMatchObject({ count: 3, maxMs: 5, medianMs: 4 })
  })
})

describe('parseRestarts', () => {
  const log = [
    '2026-10-03T23:59:00: PM2 log: App [bat-bracket:1] starting in -cluster mode-',
    '2026-10-04T07:31:05: PM2 log: App [bat-bracket:1] starting in -cluster mode-',
    '2026-10-04T07:31:05: PM2 log: App [bat-bracket:1] online',
    '2026-10-04T07:31:06: PM2 log: App [bat-bracket:_old_1] exited with code [130] via signal [SIGINT]',
    '2026-10-04T09:12:55: PM2 log: [PM2][WORKER] Process 1 restarted because it exceeds --max-memory-restart value (current_memory=3200000000 max_memory_limit=3145728000 [octets])',
    '2026-10-04T09:12:55: PM2 log: App [bat-bracket:1] starting in -cluster mode-',
    '2026-10-04T09:12:57: PM2 log: App [bat-bracket:_old_1] exited with code [130] via signal [SIGINT]',
    '2026-10-04T11:40:02: PM2 log: App [bat-bracket:1] exited with code [0] via signal [SIGABRT]',
    '2026-10-04T11:40:02: PM2 log: App [bat-bracket:1] starting in -cluster mode-',
    '2026-10-04T11:40:02: PM2 log: App [other-app:0] starting in -cluster mode-',
  ].join('\n')

  it('splits today\'s starts into reloads, memory-limit restarts and crashes', () => {
    expect(parseRestarts(log, '2026-10-04', 'bat-bracket')).toEqual({
      starts: 3,
      reloads: 1,
      memory: 1,
      crashes: 1,
      last: { at: '2026-10-04T11:40:02', reason: 'crash' },
    })
  })

  it('reports a quiet day as zeroes', () => {
    expect(parseRestarts(log, '2026-10-05', 'bat-bracket')).toEqual({
      starts: 0, reloads: 0, memory: 0, crashes: 0, last: null,
    })
  })

  it('names the last start a reload when nothing else explains it', () => {
    expect(parseRestarts(log, '2026-10-03', 'bat-bracket').last).toEqual({ at: '2026-10-03T23:59:00', reason: 'reload' })
  })
})

describe('pm2Settings', () => {
  // Imported lazily: the module reads the real environment at call time only.
  const { pm2Settings } = jest.requireActual('../lib/pm2-restarts') as typeof import('../lib/pm2-restarts')

  it('reads the settings PM2 flattens into the worker\'s environment', () => {
    expect(pm2Settings({ PM2_HOME: '/root/.pm2', pm_id: '1', name: 'bat-bracket', max_memory_restart: '3145728000' }))
      .toEqual({ home: '/root/.pm2', name: 'bat-bracket', memoryLimit: 3145728000 })
  })

  it('also accepts the single JSON variable PM2 starts the process with', () => {
    expect(pm2Settings({ PM2_HOME: '/h', pm2_env: '{"name":"app","max_memory_restart":1000}' }))
      .toEqual({ home: '/h', name: 'app', memoryLimit: 1000 })
  })

  it('reports no limit when PM2 has none set', () => {
    expect(pm2Settings({ PM2_HOME: '/h', pm_id: '0', name: 'app' })).toEqual({ home: '/h', name: 'app', memoryLimit: null })
  })

  it('is null outside PM2, even if something else sets a "name" variable', () => {
    expect(pm2Settings({ name: 'not-pm2' })).toBeNull()
    expect(pm2Settings({})).toBeNull()
  })
})
