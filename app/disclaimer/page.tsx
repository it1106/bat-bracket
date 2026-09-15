import type { Metadata } from 'next'
import Link from 'next/link'
import DisclaimerBody from '@/components/DisclaimerBody'
import { DISCLAIMER_TITLE } from '@/lib/disclaimer'

// A real route rather than a modal-only notice, so the disclaimer has a URL
// that can be linked to and shared. Static — nothing here depends on a request.
export const metadata: Metadata = {
  title: `${DISCLAIMER_TITLE} · BAT Unofficial Scoreboard`,
  description: DISCLAIMER_TITLE,
}

export default function DisclaimerPage() {
  return (
    <div className="lb-page">
      <Link href="/" className="pp-back">← Home</Link>
      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-[18px]">
        <h1 className="m-0 mb-4 text-[22px] font-bold text-[var(--brand-fg)]">
          {DISCLAIMER_TITLE}
        </h1>
        <DisclaimerBody />
      </div>
    </div>
  )
}
