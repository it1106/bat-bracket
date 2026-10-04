/**
 * @jest-environment jsdom
 */
import { loadStoredYobs, storeYobs, fetchBatYobs } from '@/lib/yobClient'

const T = 'AAAA-1111'

function mockApi(answers: Array<Record<string, { yob: string | null }>>) {
  const calls: string[][] = []
  const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { tournament: string; ids: string[] }
    calls.push(body.ids)
    return { ok: true, json: async () => answers[calls.length - 1] ?? {} } as Response
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return { calls, fetchMock }
}

beforeEach(() => localStorage.clear())

describe('stored birth years', () => {
  it('remembers years per tournament across page loads', () => {
    storeYobs(T, { '1': '2011', '2': '2012' })
    storeYobs(T, { '3': '2013' })
    expect(loadStoredYobs(T)).toEqual({ '1': '2011', '2': '2012', '3': '2013' })
    expect(loadStoredYobs('OTHER')).toEqual({})
  })

  it('treats one tournament id the same in any letter case', () => {
    storeYobs('aaaa-1111', { '1': '2011' })
    expect(loadStoredYobs('AAAA-1111')).toEqual({ '1': '2011' })
  })

  it('keeps only the most recently used tournaments', () => {
    for (let i = 0; i < 12; i++) storeYobs(`T${i}`, { '1': '2011' })
    expect(loadStoredYobs('T0')).toEqual({})
    expect(loadStoredYobs('T11')).toEqual({ '1': '2011' })
    const kept = Object.keys(JSON.parse(localStorage.getItem('batbracket.yob') ?? '{}'))
    expect(kept).toHaveLength(8)
  })

  it('survives unreadable storage', () => {
    localStorage.setItem('batbracket.yob', '{nope')
    expect(loadStoredYobs(T)).toEqual({})
    storeYobs(T, { '1': '2011' })
    expect(loadStoredYobs(T)).toEqual({ '1': '2011' })
  })
})

describe('fetchBatYobs', () => {
  it('asks for every player in one request and reports what came back', async () => {
    const { calls } = mockApi([{ '1': { yob: '2011' }, '2': { yob: null }, '3': { yob: '2013' } }])
    const batches: Array<Record<string, string>> = []
    const attempted = await fetchBatYobs(T, ['1', '2', '3'], { onYears: (m) => batches.push(m) })
    expect(calls).toEqual([['1', '2', '3']])
    expect(batches).toEqual([{ '1': '2011', '3': '2013' }])
    expect(attempted.sort()).toEqual(['1', '2', '3'])
    expect(loadStoredYobs(T)).toEqual({ '1': '2011', '3': '2013' })
  })

  it('asks again only for the players the server has not got to yet', async () => {
    const { calls } = mockApi([{ '1': { yob: '2011' } }, { '2': { yob: '2012' } }, { '3': { yob: null } }])
    await fetchBatYobs(T, ['1', '2', '3'], { onYears: () => {} })
    expect(calls).toEqual([['1', '2', '3'], ['2', '3'], ['3']])
  })

  it('stops when a request brings nothing new', async () => {
    const { calls } = mockApi([{ '1': { yob: '2011' } }, {}])
    const attempted = await fetchBatYobs(T, ['1', '2'], { onYears: () => {} })
    expect(calls).toHaveLength(2)
    expect(attempted).toEqual(['1'])
  })

  it('stops when it is cancelled, and on a failed request', async () => {
    const first = mockApi([{ '1': { yob: '2011' } }, { '2': { yob: '2012' } }])
    let cancelled = false
    await fetchBatYobs(T, ['1', '2'], { onYears: () => { cancelled = true }, isCancelled: () => cancelled })
    expect(first.calls).toHaveLength(1)

    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
    expect(await fetchBatYobs(T, ['9'], { onYears: () => {} })).toEqual([])
  })

  it('makes no request when there is nobody to ask about', async () => {
    const { fetchMock } = mockApi([])
    expect(await fetchBatYobs(T, [], { onYears: () => {} })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
