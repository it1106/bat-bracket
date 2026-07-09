import fs from 'fs'
import path from 'path'

// fetchPageHtml (Cloudflare-gated HTML) and fetchTournamentDetail (extranet API)
// are the two external calls resolveBwfUrl orchestrates; the sidecar write is the
// observable side effect. Mock all three; extractMeta/parse helpers run for real.
jest.mock('../lib/providers/bwf/cf-context', () => ({
  fetchPageHtml: jest.fn(),
}))
jest.mock('../lib/providers/bwf/api-client', () => ({
  fetchTournamentDetail: jest.fn(),
}))
jest.mock('../lib/providers/bwf/sidecar', () => ({
  saveSidecarEntry: jest.fn(),
  lookupByUrl: jest.fn().mockReturnValue(null),
}))

import { resolveBwfUrl } from '@/lib/providers/bwf/url-resolver-runtime'
import { fetchPageHtml } from '@/lib/providers/bwf/cf-context'
import { fetchTournamentDetail } from '@/lib/providers/bwf/api-client'
import { saveSidecarEntry, lookupByUrl } from '@/lib/providers/bwf/sidecar'

const mockFetchHtml = fetchPageHtml as jest.MockedFunction<typeof fetchPageHtml>
const mockDetail = fetchTournamentDetail as jest.MockedFunction<typeof fetchTournamentDetail>
const mockSave = saveSidecarEntry as jest.MockedFunction<typeof saveSidecarEntry>
const mockLookup = lookupByUrl as jest.MockedFunction<typeof lookupByUrl>

const goodHtml = () =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', 'tournament-page.html'), 'utf-8')

const CF_CHALLENGE = '<html><head><title>Attention Required! | Cloudflare</title></head><body>Enable JavaScript and cookies to continue</body></html>'

const detailResults = {
  id: 5738,
  code: 'F25A7927-E9BA-47C8-959D-42A013B65592',
  name: 'YONEX SUNRISE Pembangunan Jaya Raya Junior International Grand Prix 2026',
  slug: 'yonex-sunrise-pembangunan-jaya-raya-junior-international-grand-prix-2026',
  start_date: '2026-07-07 00:00:00',
  end_date: '2026-07-12 00:00:00',
}

beforeEach(() => {
  mockFetchHtml.mockReset()
  mockDetail.mockReset()
  mockSave.mockReset()
  mockLookup.mockReturnValue(null)
})

describe('resolveBwfUrl — HTML path (unchanged)', () => {
  it('resolves from the page HTML and does not touch the detail API', async () => {
    mockFetchHtml.mockResolvedValue(goodHtml())
    await resolveBwfUrl('https://bwfbadminton.com/tournament/5726/mith-yonex-pathumthanee/')

    expect(mockDetail).not.toHaveBeenCalled()
    expect(mockSave).toHaveBeenCalledTimes(1)
    const [, entry] = mockSave.mock.calls[0]
    expect(entry).toMatchObject({
      tmtId: 5726,
      tournamentCode: '6E65C36E-497D-42D2-8F4E-78A2D30D9893',
    })
  })
})

describe('resolveBwfUrl — extranet-API fallback when the HTML is Cloudflare-challenged', () => {
  const url =
    'https://bwfbadminton.com/tournament/5738/yonex-sunrise-pembangunan-jaya-raya-junior-international-grand-prix-2026/'

  it('falls back to vue-tournament-detail (by tmtId parsed from the URL) and seeds the sidecar', async () => {
    mockFetchHtml.mockResolvedValue(CF_CHALLENGE)
    mockDetail.mockResolvedValue({ results: detailResults })

    await resolveBwfUrl(url)

    expect(mockDetail).toHaveBeenCalledWith({ tmtId: 5738 })
    expect(mockSave).toHaveBeenCalledTimes(1)
    const [savedUrl, entry] = mockSave.mock.calls[0]
    expect(savedUrl).toBe(url)
    expect(entry).toMatchObject({
      tmtId: 5738,
      tournamentCode: 'F25A7927-E9BA-47C8-959D-42A013B65592',
      slug: detailResults.slug,
      name: detailResults.name,
      startDateIso: '2026-07-07',
      endDateIso: '2026-07-12',
    })
    expect(typeof (entry as { resolvedAt: string }).resolvedAt).toBe('string')
  })

  it('does not seed when the fallback detail is also unusable', async () => {
    mockFetchHtml.mockResolvedValue(CF_CHALLENGE)
    mockDetail.mockResolvedValue({ results: { id: 5738 } }) // missing code/name/slug

    await resolveBwfUrl(url)

    expect(mockSave).not.toHaveBeenCalled()
  })

  it('does not attempt the fallback when the URL has no numeric tmtId', async () => {
    mockFetchHtml.mockResolvedValue(CF_CHALLENGE)
    await resolveBwfUrl('https://bwfbadminton.com/tournament/not-a-number/foo/')

    expect(mockDetail).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('skips all work when the URL is already resolved in the sidecar', async () => {
    mockLookup.mockReturnValue({
      tmtId: 5738, tournamentCode: 'X', slug: 's', name: 'n',
      startDateIso: '', endDateIso: '', resolvedAt: 'z',
    })
    await resolveBwfUrl(url)
    expect(mockFetchHtml).not.toHaveBeenCalled()
    expect(mockDetail).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()
  })
})
