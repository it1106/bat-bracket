'use client'

import { useLanguage } from '@/lib/LanguageContext'
import { DISCLAIMER, BAT_OFFICIAL_URL } from '@/lib/disclaimer'

/** The disclaimer's paragraphs in the reader's chosen language, rendered
 *  identically wherever they appear (the /disclaimer page and the top-bar
 *  modal). The explicit `lang` gives the browser the right line-breaking
 *  rules — it matters for the Thai copy, which has no inter-word spaces. */
export default function DisclaimerBody() {
  const { lang } = useLanguage()
  const { paragraphs } = DISCLAIMER[lang]
  return (
    <div lang={lang} className="space-y-3 text-sm leading-relaxed text-[var(--fg)]">
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <p>
        <a
          href={BAT_OFFICIAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--brand-fg)] font-semibold hover:underline"
        >
          bat.tournamentsoftware.com ↗
        </a>
      </p>
    </div>
  )
}
