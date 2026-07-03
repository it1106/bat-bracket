// BWF migrated the vue-tournament-* endpoints from POST to GET (POST now 405s).
// These assertions lock in GET + query-string so a revert to POST is caught in
// CI instead of silently blanking every BWF bracket in prod again.
jest.mock('../lib/providers/bwf/cf-context', () => ({
  request: jest.fn().mockResolvedValue({ results: [] }),
}))

import { fetchTournamentDetail, fetchTournamentDraws, fetchTournamentDrawData } from '@/lib/providers/bwf/api-client'
import { request } from '@/lib/providers/bwf/cf-context'

const mockRequest = request as jest.MockedFunction<typeof request>

beforeEach(() => mockRequest.mockClear())

describe('bwf api-client transport', () => {
  it('fetchTournamentDraws uses GET with query params, no body', async () => {
    await fetchTournamentDraws({ tmtId: 5738 })
    expect(mockRequest).toHaveBeenCalledTimes(1)
    const [method, path, body] = mockRequest.mock.calls[0]
    expect(method).toBe('GET')
    expect(path).toBe('/api/vue-tournament-draws?tmtId=5738&tmtType=0&tmtTab=draw')
    expect(body).toBeUndefined()
  })

  it('fetchTournamentDetail uses GET with tmtId in the query', async () => {
    await fetchTournamentDetail({ tmtId: 5738 })
    const [method, path] = mockRequest.mock.calls[0]
    expect(method).toBe('GET')
    expect(path).toBe('/api/vue-tournament-detail?tmtId=5738')
  })

  it('fetchTournamentDrawData uses GET with drawId in the query', async () => {
    await fetchTournamentDrawData({ tmtId: 5738, drawId: '1' })
    const [method, path] = mockRequest.mock.calls[0]
    expect(method).toBe('GET')
    expect(path).toBe('/api/vue-tournament-draw-data?tmtId=5738&tmtType=0&tmtTab=draw&drawId=1&isPara=false')
  })
})
