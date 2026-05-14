import { batProvider } from '../lib/providers/bat-provider'

jest.mock('../lib/bat-fetch', () => ({
  batFetch: jest.fn(),
}))

import { batFetch } from '../lib/bat-fetch'
import fs from 'fs'
import path from 'path'

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

const okResponse = (body: string) => ({
  ok: true,
  status: 200,
  text: async () => body,
}) as unknown as Response

describe('batProvider.getEventBundle', () => {
  beforeEach(() => {
    (batFetch as jest.Mock).mockReset()
  })

  it('returns null when no playoff sibling exists', async () => {
    (batFetch as jest.Mock).mockImplementation((_kind: string, url: string) => {
      if (url.includes('/draws.aspx')) return Promise.resolve(okResponse(fixture('draws-grouped.html')))
      return Promise.resolve(okResponse(''))
    })
    const out = await batProvider.getEventBundle(
      { id: 'a2812d92-b33f-4f37-ac72-3310bb1be0f1', provider: 'bat' },
      'Nonexistent Event',
    )
    expect(out).toBeNull()
  })

  it('assembles a bundle for BS U11 with 8 groups + playoff', async () => {
    (batFetch as jest.Mock).mockImplementation((_kind: string, url: string) => {
      if (url.includes('/draws.aspx')) return Promise.resolve(okResponse(fixture('draws-grouped.html')))
      if (url.includes('GetStandings')) return Promise.resolve(okResponse(fixture('group-standings-bs-u11-a.html')))
      if (url.includes('/Draw/9/')) return Promise.resolve(okResponse(fixture('playoff-draw-bs-u11.html')))
      if (url.includes('GetDrawContent')) return Promise.resolve(okResponse(fixture('group-draw-bs-u11-a.html')))
      return Promise.resolve(okResponse(''))
    })
    const bundle = await batProvider.getEventBundle(
      { id: 'a2812d92-b33f-4f37-ac72-3310bb1be0f1', provider: 'bat' },
      'BS U11',
    )
    expect(bundle).not.toBeNull()
    expect(bundle!.eventName).toBe('BS U11')
    expect(bundle!.playoffDrawNum).toBe('9')
    expect(bundle!.groups).toHaveLength(8)
    expect(bundle!.groups.map((g) => g.groupLetter)).toEqual(['A','B','C','D','E','F','G','H'])
    expect(bundle!.groups[0].standings.length).toBeGreaterThan(0)
    expect(bundle!.playoff.format).toBeDefined()
  })

  it('tolerates a single failed sub-fetch (returns partial bundle)', async () => {
    let standingsCall = 0
    ;(batFetch as jest.Mock).mockImplementation((_kind: string, url: string) => {
      if (url.includes('/draws.aspx')) return Promise.resolve(okResponse(fixture('draws-grouped.html')))
      if (url.includes('GetStandings')) {
        standingsCall++
        if (standingsCall === 1) return Promise.resolve({ ok: false, status: 502 } as Response)
        return Promise.resolve(okResponse(fixture('group-standings-bs-u11-a.html')))
      }
      if (url.includes('/Draw/9/')) return Promise.resolve(okResponse(fixture('playoff-draw-bs-u11.html')))
      if (url.includes('GetDrawContent')) return Promise.resolve(okResponse(fixture('group-draw-bs-u11-a.html')))
      return Promise.resolve(okResponse(''))
    })
    const bundle = await batProvider.getEventBundle(
      { id: 'a2812d92-b33f-4f37-ac72-3310bb1be0f1', provider: 'bat' },
      'BS U11',
    )
    expect(bundle).not.toBeNull()
    expect(bundle!.groups).toHaveLength(8)
    expect(bundle!.groups[0].standings).toEqual([])
  })
})
