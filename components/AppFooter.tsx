'use client'

import Link from 'next/link'
import { useLanguage } from '@/lib/LanguageContext'
import { DISCLAIMER } from '@/lib/disclaimer'

/** The global footer, rendered by the root layout so the disclaimer is
 *  reachable from every route. A client component only because the link's
 *  label follows the reader's chosen language. */
export default function AppFooter() {
  const { lang } = useLanguage()
  return (
    <footer className="app-footer">
      <Link href="/disclaimer" lang={lang}>{DISCLAIMER[lang].title}</Link>
    </footer>
  )
}
