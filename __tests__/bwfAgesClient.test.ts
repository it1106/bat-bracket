import { fetchBwfAges } from '@/lib/bwfAgesClient'

type Ages = Record<string, { age: number | null; dob: string | null }>
const age = (dob: string | null) => ({ age: dob ? 13 : null, dob })

// A server that knows `known` and answers at most `perRequest` new players a
// time, the way /api/bwf/player-ages does.
function server(known: Ages, perRequest: number) {
  const answered = new Set<string>()
  const calls: string[][] = []
  const fetchFn = jest.fn(async (url: string) => {
    const ids = decodeURIComponent(url.split('ids=')[1]).split(',')
    calls.push(ids)
    let fresh = 0
    const body: Ages = {}
    for (const id of ids) {
      if (!(id in known)) continue
      if (!answered.has(id)) {
        if (fresh >= perRequest) continue
        fresh++
        answered.add(id)
      }
      body[id] = known[id]
    }
    return { ok: true, json: async () => body }
  })
  return { fetchFn, calls }
}

describe('fetchBwfAges', () => {
  it('asks once when the server answers for everyone', async () => {
    const { fetchFn } = server({ '1': age('2013-06-06'), '2': age(null) }, 10)
    const out = await fetchBwfAges(['1', '2'], { fetchFn })
    expect(out).toEqual({ '1': age('2013-06-06'), '2': age(null) })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('asks again for whoever was left out, until everyone is answered', async () => {
    const known: Ages = {}
    for (let i = 1; i <= 7; i++) known[String(i)] = age('2013-06-06')
    const { fetchFn, calls } = server(known, 3)
    const out = await fetchBwfAges(Object.keys(known), { fetchFn })
    expect(Object.keys(out)).toHaveLength(7)
    expect(calls.map((c) => c.length)).toEqual([7, 4, 1])
  })

  it('hands over each batch as it arrives', async () => {
    const known: Ages = { '1': age('2013-06-06'), '2': age('2012-01-01'), '3': age(null) }
    const { fetchFn } = server(known, 2)
    const batches: string[][] = []
    await fetchBwfAges(['1', '2', '3'], { fetchFn, onBatch: (b) => batches.push(Object.keys(b)) })
    expect(batches).toEqual([['1', '2'], ['3']])
  })

  it('stops asking about players the server never answers for', async () => {
    const { fetchFn } = server({ '1': age('2013-06-06') }, 10)
    const out = await fetchBwfAges(['1', '2', '3'], { fetchFn })
    expect(out).toEqual({ '1': age('2013-06-06') })
    // Once for all three, once more for the two left out, then it gives up.
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('stops on a failed request and keeps what it has', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ '1': age('2013-06-06') }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const out = await fetchBwfAges(['1', '2'], { fetchFn })
    expect(out).toEqual({ '1': age('2013-06-06') })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('stops asking once it is told to', async () => {
    const known: Ages = { '1': age('2013-06-06'), '2': age('2012-01-01') }
    const { fetchFn } = server(known, 1)
    let stop = false
    await fetchBwfAges(['1', '2'], { fetchFn, onBatch: () => { stop = true }, cancelled: () => stop })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('asks for nobody when given nobody', async () => {
    const fetchFn = jest.fn()
    expect(await fetchBwfAges([], { fetchFn })).toEqual({})
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
