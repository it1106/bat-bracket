/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import PrivacyCard from '@/components/PrivacyCard'
import AppFooter from '@/components/AppFooter'
import { LanguageProvider } from '@/lib/LanguageContext'
import { PRIVACY } from '@/lib/privacy'

function renderIn(lang: 'en' | 'th', ui: React.ReactElement) {
  localStorage.setItem('batbracket.lang', lang)
  return render(<LanguageProvider>{ui}</LanguageProvider>)
}

afterEach(() => localStorage.clear())

describe('privacy text', () => {
  it('carries the same sections in both languages, none of them empty', () => {
    expect(PRIVACY.en.sections).toHaveLength(PRIVACY.th.sections.length)
    for (const l of ['en', 'th'] as const) {
      expect(PRIVACY[l].title.trim().length).toBeGreaterThan(0)
      for (const s of PRIVACY[l].sections) {
        expect(s.heading.trim().length).toBeGreaterThan(0)
        expect(s.body.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('says what following a player or a club stores, in both languages', () => {
    const en = PRIVACY.en.sections.find((s) => s.heading === 'Match alerts')
    const th = PRIVACY.th.sections.find((s) => s.heading === 'การแจ้งเตือนแมตช์')
    expect(en?.body).toMatch(/push address/)
    expect(en?.body).toMatch(/players and clubs/)
    expect(en?.body).toMatch(/60 days/)
    expect(th?.body).toMatch(/60 วัน/)
    // in the same place in both languages, before "Your choices"
    expect(PRIVACY.en.sections.findIndex((s) => s.heading === 'Match alerts')).toBe(6)
    expect(PRIVACY.th.sections.findIndex((s) => s.heading === 'การแจ้งเตือนแมตช์')).toBe(6)
  })

  it('names the site and its analytics processor in both languages', () => {
    for (const l of ['en', 'th'] as const) {
      const all = PRIVACY[l].sections.map((s) => s.body).join(' ')
      expect(all).toContain('BATMatch')
      expect(all).toContain('PostHog')
    }
  })
})

describe('PrivacyCard', () => {
  it.each(['en', 'th'] as const)('renders every %s section verbatim', (lang) => {
    const { container } = renderIn(lang, <PrivacyCard />)
    const text = container.textContent ?? ''
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(PRIVACY[lang].title)
    for (const s of PRIVACY[lang].sections) {
      expect(text).toContain(s.heading)
      expect(text).toContain(s.body)
    }
  })
})

describe('AppFooter', () => {
  it.each(['en', 'th'] as const)('links to the privacy notice in %s', (lang) => {
    renderIn(lang, <AppFooter />)
    const link = screen.getByRole('link', { name: PRIVACY[lang].title })
    expect(link.getAttribute('href')).toBe('/privacy')
  })

  it('still links to the disclaimer', () => {
    renderIn('en', <AppFooter />)
    expect(screen.getByRole('link', { name: 'Disclaimer' }).getAttribute('href')).toBe('/disclaimer')
  })
})
