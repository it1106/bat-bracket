'use client'

import Link from 'next/link'
import { useLanguage } from '@/lib/LanguageContext'
import { DISCLAIMER } from '@/lib/disclaimer'
import { PRIVACY } from '@/lib/privacy'

/** The global footer, rendered by the root layout so the disclaimer and the
 *  privacy notice are reachable from every route. A client component only
 *  because the links' labels follow the reader's chosen language. */
export default function AppFooter() {
  const { lang } = useLanguage()
  return (
    <footer className="app-footer">
      <Link href="/disclaimer" lang={lang}>{DISCLAIMER[lang].title}</Link>
      <span className="app-footer-sep" aria-hidden="true">·</span>
      <Link href="/privacy" lang={lang}>{PRIVACY[lang].title}</Link>
    </footer>
  )
}
