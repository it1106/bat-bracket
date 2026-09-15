import { DISCLAIMER_PARAGRAPHS, BAT_OFFICIAL_URL } from '@/lib/disclaimer'

/** The disclaimer's paragraphs, rendered identically wherever they appear (the
 *  /disclaimer page and the top-bar modal). `lang="th"` so the browser picks
 *  Thai line-breaking rules even when the UI is in English. */
export default function DisclaimerBody() {
  return (
    <div lang="th" className="space-y-3 text-sm leading-relaxed text-[var(--fg)]">
      {DISCLAIMER_PARAGRAPHS.map((p, i) => (
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
