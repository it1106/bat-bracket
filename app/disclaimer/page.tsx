import type { Metadata } from 'next'
import Link from 'next/link'
import DisclaimerCard from '@/components/DisclaimerCard'
import { DISCLAIMER_METADATA_TITLE } from '@/lib/disclaimer'

// A real route rather than a modal-only notice, so the disclaimer has a URL
// that can be linked to and shared. The document title carries both languages:
// it is rendered on the server, which cannot know the reader's choice.
export const metadata: Metadata = {
  title: `${DISCLAIMER_METADATA_TITLE} · BAT Unofficial Scoreboard`,
  description: DISCLAIMER_METADATA_TITLE,
}

export default function DisclaimerPage() {
  return (
    <div className="lb-page">
      <Link href="/" className="pp-back">← Home</Link>
      <DisclaimerCard />
    </div>
  )
}
