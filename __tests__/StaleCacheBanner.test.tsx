/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import StaleCacheBanner from '../components/StaleCacheBanner'
import { LanguageProvider } from '@/lib/LanguageContext'

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
    expect(screen.getByText(/BAT is unreachable/i)).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
