import { makeFetchDraws, makeFetchScheduleDays, makeProbeBracket, makeProbeDay } from '@/lib/push/publications'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const ok = (body: unknown) => ({ ok: true, json: async () => body })
const notOk = { ok: false, json: async () => null }

describe('makeFetchDraws', () => {
  it('asks the app for the draws with the id lower-cased, and keeps the counts', async () => {
    const urls: string[] = []
    const draws = await makeFetchDraws('http://o', async (url) => { urls.push(url); return ok([{ drawNum: '1', name: 'BS U15', size: '32', type: 'Elimination', entrantCount: 16 }]) })(TID)
    expect(urls[0]).toBe(`http://o/api/draws?id=${TID.toLowerCase()}`)
    expect(draws).toEqual([{ drawNum: '1', name: 'BS U15', entrantCount: 16 }])
  })

  it('is null when the app says no', async () => {
    expect(await makeFetchDraws('http://o', async () => notOk)(TID)).toBeNull()
  })

  it('is null when the answer is not a list', async () => {
    expect(await makeFetchDraws('http://o', async () => ok({ error: 'nope' }))(TID)).toBeNull()
  })
})

describe('makeFetchScheduleDays', () => {
  it('gives the days with their hasMatches flags', async () => {
    const urls: string[] = []
    const days = await makeFetchScheduleDays('http://o', async (url) => { urls.push(url); return ok({ days: [{ date: '20/10/2026', label: 'Tue', dateIso: '2026-10-20', hasMatches: true }], currentDate: '', groups: [] }) })(TID)
    expect(urls[0]).toBe(`http://o/api/matches?tournament=${TID}`)
    expect(days).toEqual([{ dateIso: '2026-10-20', date: '20/10/2026', hasMatches: true }])
  })

  it('is null when the app says no, and an empty list when there are no days', async () => {
    expect(await makeFetchScheduleDays('http://o', async () => notOk)(TID)).toBeNull()
    expect(await makeFetchScheduleDays('http://o', async () => ok({ currentDate: '', groups: [] }))(TID)).toEqual([])
  })
})

describe('makeProbeBracket', () => {
  it('asks the app for one bracket, which caches its entrant count', async () => {
    const urls: string[] = []
    await makeProbeBracket('http://o', async (url) => { urls.push(url); return ok({}) })(TID, '4')
    expect(urls[0]).toBe(`http://o/api/bracket?tournament=${TID.toLowerCase()}&event=4`)
  })

  it('swallows a failure, because an unknown count is simply probed again', async () => {
    await expect(makeProbeBracket('http://o', async () => { throw new Error('boom') })(TID, '4')).resolves.toBeUndefined()
  })
})

describe('makeFetchScheduleDays — the day key', () => {
  it('keeps BAT\'s own date string, which is what a per-day read needs', async () => {
    const days = await makeFetchScheduleDays('http://o', async () => ok({
      days: [{ date: '20261020', label: '20/10', dateIso: '2026-10-20' }], currentDate: '', groups: [],
    }))(TID)
    expect(days).toEqual([{ dateIso: '2026-10-20', date: '20261020' }])
  })
})

describe('makeProbeDay', () => {
  it('says a day has matches when the schedule for it is not empty', async () => {
    const urls: string[] = []
    const probe = makeProbeDay('http://o', async (url) => {
      urls.push(url)
      return ok({ days: [], currentDate: '', groups: [{ type: 'time', time: '9:00', matches: [] }] })
    })
    expect(await probe(TID, '20261020')).toBe(true)
    expect(urls[0]).toBe(`http://o/api/matches?tournament=${TID}&date=20261020`)
  })

  it('says a day has none when the schedule for it is empty', async () => {
    expect(await makeProbeDay('http://o', async () => ok({ days: [], currentDate: '', groups: [] }))(TID, '20261020')).toBe(false)
  })

  it('is null — not false — when the day could not be read', async () => {
    expect(await makeProbeDay('http://o', async () => notOk)(TID, '20261020')).toBeNull()
    expect(await makeProbeDay('http://o', async () => { throw new Error('boom') })(TID, '20261020')).toBeNull()
  })
})
