/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import DisclaimerCard from '@/components/DisclaimerCard'
import AppFooter from '@/components/AppFooter'
import { LanguageProvider } from '@/lib/LanguageContext'
import { DISCLAIMER, BAT_OFFICIAL_URL } from '@/lib/disclaimer'

// LanguageProvider starts on 'en' and reads the stored choice in an effect, so
// seeding localStorage before render is what puts a test in Thai.
function renderIn(lang: 'en' | 'th', ui: React.ReactElement) {
  localStorage.setItem('batbracket.lang', lang)
  return render(<LanguageProvider>{ui}</LanguageProvider>)
}

afterEach(() => localStorage.clear())

describe('disclaimer text', () => {
  it('carries the same number of paragraphs in both languages', () => {
    expect(DISCLAIMER.en.paragraphs).toHaveLength(DISCLAIMER.th.paragraphs.length)
    for (const l of ['en', 'th'] as const) {
      expect(DISCLAIMER[l].title.trim().length).toBeGreaterThan(0)
      for (const p of DISCLAIMER[l].paragraphs) expect(p.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('DisclaimerCard', () => {
  it.each(['en', 'th'] as const)('renders every %s paragraph verbatim', (lang) => {
    const { container } = renderIn(lang, <DisclaimerCard />)
    const text = container.textContent ?? ''
    expect(screen.getByRole('heading').textContent).toBe(DISCLAIMER[lang].title)
    for (const p of DISCLAIMER[lang].paragraphs) expect(text).toContain(p)
  })

  it('shows the other language once the reader switches', () => {
    const { container } = renderIn('th', <DisclaimerCard />)
    expect(container.textContent).toContain(DISCLAIMER.th.paragraphs[0])
    expect(container.textContent).not.toContain(DISCLAIMER.en.paragraphs[0])
  })

  it('links out to BAT so "verify with BAT" is actionable', () => {
    renderIn('en', <DisclaimerCard />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.href).toBe(BAT_OFFICIAL_URL)
    expect(link.rel).toContain('noopener')
  })
})

describe('AppFooter', () => {
  it.each(['en', 'th'] as const)('labels the %s link with that language\'s title', (lang) => {
    renderIn(lang, <AppFooter />)
    // The footer also links to the privacy notice, so pick this link by name.
    const link = screen.getByRole('link', { name: DISCLAIMER[lang].title })
    expect(link.textContent).toBe(DISCLAIMER[lang].title)
    expect(link.getAttribute('href')).toBe('/disclaimer')
  })
})
