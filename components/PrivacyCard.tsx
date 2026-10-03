'use client'

import { useLanguage } from '@/lib/LanguageContext'
import { PRIVACY } from '@/lib/privacy'

/** The /privacy page's content. Client-side because it follows the reader's
 *  chosen language, like the disclaimer. */
export default function PrivacyCard() {
  const { lang } = useLanguage()
  const { title, sections } = PRIVACY[lang]
  return (
    <div lang={lang} className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-[18px]">
      <h1 className="m-0 mb-4 text-[length:calc(22px*var(--text-scale))] font-bold text-[var(--brand-fg)]">
        {title}
      </h1>
      {sections.map(({ heading, body }) => (
        <section key={heading} className="mb-4 last:mb-0">
          <h2 className="m-0 mb-1 text-[length:calc(15px*var(--text-scale))] font-semibold text-[var(--fg)]">
            {heading}
          </h2>
          <p className="m-0 text-[length:calc(14px*var(--text-scale))] leading-relaxed text-[var(--fg)]">{body}</p>
        </section>
      ))}
    </div>
  )
}
