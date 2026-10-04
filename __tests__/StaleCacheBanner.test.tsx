/** @jest-environment jsdom */
import { render, screen, act } from '@testing-library/react'
import StaleCacheBanner from '../components/StaleCacheBanner'
import { LanguageProvider } from '@/lib/LanguageContext'
import { noteBatDownSince, formatDownSince, __resetBatDownSinceForTesting } from '@/lib/batDownSince'

beforeEach(() => __resetBatDownSinceForTesting())

describe('StaleCacheBanner', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(
      <LanguageProvider>
        <StaleCacheBanner visible={false} />
      </LanguageProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the English warning when visible', () => {
    render(
      <LanguageProvider>
        <StaleCacheBanner visible={true} />
      </LanguageProvider>,
    )
    // Default lang is English. Match a stable substring so tweaks to the
    // exact copy don't break the test.
    expect(screen.getByText('BAT server is down — serving from cache. Data may be behind.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('says when BAT went down once the server has told it, in Bangkok time', () => {
    render(
      <LanguageProvider>
        <StaleCacheBanner visible={true} />
      </LanguageProvider>,
    )
    const since = new Date(Date.now() - 50 * 60_000)
    act(() => {
      noteBatDownSince({ headers: new Headers({ 'X-Bat-Down-Since': since.toISOString() }) } as Response)
    })
    const hhmm = since.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
    expect(screen.getByText(`BAT server is down since ${hhmm} — serving from cache. Data may be behind.`)).toBeInTheDocument()
  })
})

describe('formatDownSince', () => {
  const now = Date.parse('2026-10-05T00:20:00+07:00')

  it('gives the time alone for an outage that began within the day', () => {
    expect(formatDownSince('2026-10-04T16:31:21.000Z', now)).toBe('23:31')
  })

  it('puts the date in front of an older one', () => {
    expect(formatDownSince('2026-10-03T07:02:00.000Z', now)).toBe('3 Oct 14:02')
  })
})
