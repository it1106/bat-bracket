/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import MinimalPlayerProfile from '@/components/MinimalPlayerProfile'
import type { Ranking, RankingPlayerRank } from '@/lib/types'

// Mock useRouter — the component reads it for the back button, but we
// don't trigger that branch in this test.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}))

// Mock the language context so we don't need a provider wrapper.
jest.mock('../lib/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

// Mock RankingDetailTabs so we can assert on the props without rendering
// the whole tab UI (it has its own tests).
const detailTabsMock: jest.Mock = jest.fn((_props: unknown) => <div data-testid="ranking-detail-tabs" />)
jest.mock('../components/RankingDetailTabs', () => ({
  __esModule: true,
  default: (props: unknown) => detailTabsMock(props),
}))

const baseRankings: RankingPlayerRank[] = [
  { eventName: "Boy's singles U15", rank: 1, points: 4600, tournaments: 0 },
  { eventName: "Boy's singles U17", rank: 24, points: 1380, tournaments: 0 },
]

const baseRanking: Ranking = {
  provider: 'bwf', scrapedAt: 'x', publishDate: '03/06/2026', rankingId: '52035', events: [],
}

beforeEach(() => { detailTabsMock.mockClear() })

describe('MinimalPlayerProfile', () => {
  it('renders the display name', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="zhang_jia_lun"
        displayName="ZHANG Jia Lun"
        country="China"
        playerRankings={baseRankings}
        rankingPublishDate="03/06/2026"
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ZHANG Jia Lun')
  })

  it('renders the country with the globe icon', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="zhang_jia_lun"
        displayName="ZHANG Jia Lun"
        country="China"
        playerRankings={baseRankings}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByText('China')).toBeInTheDocument()
    // The globe glyph is part of the row.
    const meta = screen.getByText('China').closest('span')
    expect(meta?.textContent).toContain('🌐')
  })

  it('hides the country row when country is empty', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country=""
        playerRankings={baseRankings}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.queryByText('🌐')).not.toBeInTheDocument()
  })

  it('lists each ranking entry with rank, tournaments, and points', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="zhang_jia_lun"
        displayName="ZHANG Jia Lun"
        country="China"
        playerRankings={baseRankings}
        rankingPublishDate="03/06/2026"
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByText("Boy's singles U15")).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('4,600 pts')).toBeInTheDocument()
    expect(screen.getByText("Boy's singles U17")).toBeInTheDocument()
    expect(screen.getByText('#24')).toBeInTheDocument()
    expect(screen.getByText('1,380 pts')).toBeInTheDocument()
  })

  it('hides the "tn" badge when tournaments is 0 (BWF leaderboard data)', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country="China"
        playerRankings={[{ eventName: "Boy's singles U15", rank: 1, points: 4600, tournaments: 0 }]}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.queryByText(/0 tn/)).not.toBeInTheDocument()
  })

  it('shows the "tn" badge when tournaments is positive (computed from cached detail)', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country="China"
        playerRankings={[{ eventName: "Boy's singles U15", rank: 1, points: 4600, tournaments: 7 }]}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByText('7 tn')).toBeInTheDocument()
  })

  it('omits the BWF Badminton Asia Ranking section when there are no rankings', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country="China"
        playerRankings={[]}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.queryByText('BWF Badminton Asia Ranking')).not.toBeInTheDocument()
  })

  it('uses the BWF heading when provider is bwf', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country="China"
        playerRankings={baseRankings}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByText(/BWF Badminton Asia Ranking/)).toBeInTheDocument()
  })

  it('forwards detail-panel props to RankingDetailTabs', () => {
    const initialDetail = {
      globalPlayerId: '8934872',
      publishDate: '03/06/2026',
      scrapedAt: 'x',
      tournaments: [],
    }
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="zhang_jia_lun"
        displayName="ZHANG Jia Lun"
        country="China"
        playerRankings={baseRankings}
        rankingPublishDate="03/06/2026"
        initialDetail={initialDetail}
        currentRanking={baseRanking}
      />,
    )
    expect(detailTabsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'bwf',
        slug: 'zhang_jia_lun',
        initialDetail,
        rankingPublishDate: '03/06/2026',
        currentRanking: baseRanking,
      }),
    )
    expect(screen.getByTestId('ranking-detail-tabs')).toBeInTheDocument()
  })

  it('shows the "as of" date with week key in the header', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country="China"
        playerRankings={baseRankings}
        rankingPublishDate="03/06/2026"
        currentRanking={baseRanking}
      />,
    )
    // 3 June 2026 = ISO week 23.
    expect(screen.getByText(/as of 03\/06\/2026 \(2026-23\)/)).toBeInTheDocument()
  })
})
