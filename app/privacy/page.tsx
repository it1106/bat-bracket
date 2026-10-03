import type { Metadata } from 'next'
import Link from 'next/link'
import PrivacyCard from '@/components/PrivacyCard'
import { PRIVACY_METADATA_TITLE } from '@/lib/privacy'

// What the site records about its visitors. A real route so it has a URL that
// can be linked to; the footer links here from every page.
export const metadata: Metadata = {
  title: `${PRIVACY_METADATA_TITLE} · BAT Unofficial Scoreboard`,
  description: PRIVACY_METADATA_TITLE,
}

export default function PrivacyPage() {
  return (
    <div className="lb-page">
      <Link href="/" className="pp-back">← Home</Link>
      <PrivacyCard />
    </div>
  )
}
