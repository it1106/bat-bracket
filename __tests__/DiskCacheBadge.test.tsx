/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import DiskCacheBadge from '../components/DiskCacheBadge'
import { LanguageProvider } from '@/lib/LanguageContext'

describe('DiskCacheBadge', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(
      <LanguageProvider>
        <DiskCacheBadge visible={false} />
      </LanguageProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the label and tooltip when visible', () => {
    render(
      <LanguageProvider>
        <DiskCacheBadge visible={true} />
      </LanguageProvider>,
    )
    // English default. Loose substring so wording tweaks don't break the test.
    expect(screen.getByText(/Cached/i)).toBeInTheDocument()
    const badge = screen.getByRole('status')
    expect(badge).toBeInTheDocument()
    expect(badge.getAttribute('title')).toMatch(/disk cache/i)
  })
})
