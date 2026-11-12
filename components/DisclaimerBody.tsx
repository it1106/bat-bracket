'use client'

import { useLanguage } from '@/lib/LanguageContext'
import { DISCLAIMER, BAT_OFFICIAL_URL, BWF_OFFICIAL_URL } from '@/lib/disclaimer'

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
      {/* One link per governing body the notice names, so "verify with BAT or
          BWF" is actionable for either. */}
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        {[
          { href: BAT_OFFICIAL_URL, label: 'bat.tournamentsoftware.com' },
          { href: BWF_OFFICIAL_URL, label: 'bwfbadminton.com' },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--brand-fg)] font-semibold hover:underline"
          >
            {label} ↗
          </a>
        ))}
      </p>
    </div>
  )
}
