import { recordPush, getPushStats } from '@/lib/push/stats'

describe('push stats', () => {
  it('counts the day\'s results and starts again on a new day', () => {
    recordPush('ok', '2030-01-01')
    recordPush('ok', '2030-01-01')
    recordPush('failed', '2030-01-01')
    recordPush('gone', '2030-01-01')
    expect(getPushStats('2030-01-01')).toEqual({ sentToday: 2, failedToday: 1, goneToday: 1 })
    expect(getPushStats('2030-01-02')).toEqual({ sentToday: 0, failedToday: 0, goneToday: 0 })
  })

  it('is one count for the whole process: what the watcher\'s copy records, the status page\'s copy reads', () => {
    let watcherCopy!: typeof import('@/lib/push/stats')
    jest.isolateModules(() => { watcherCopy = require('../lib/push/stats') })
    expect(watcherCopy.recordPush).not.toBe(recordPush)
    watcherCopy.recordPush('ok', '2030-02-01')
    watcherCopy.recordPush('failed', '2030-02-01')
    expect(getPushStats('2030-02-01')).toEqual({ sentToday: 1, failedToday: 1, goneToday: 0 })
  })
})
