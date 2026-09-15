'use client'

import { useLanguage } from '@/lib/LanguageContext'
import DisclaimerBody from '@/components/DisclaimerBody'
import { DISCLAIMER } from '@/lib/disclaimer'

/** Heading + body for the /disclaimer page. Client-side because the heading,
 *  like the text under it, follows the reader's chosen language. */
export default function DisclaimerCard() {
  const { lang } = useLanguage()
  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-[18px]">
      <h1 lang={lang} className="m-0 mb-4 text-[22px] font-bold text-[var(--brand-fg)]">
        {DISCLAIMER[lang].title}
      </h1>
      <DisclaimerBody />
    </div>
  )
}
