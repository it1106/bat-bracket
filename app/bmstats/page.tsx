import type { Metadata } from 'next'
import Link from 'next/link'
import BmStats, { BmStatsThemeToggle } from '@/components/BmStats'

// Server status for whoever runs the site. Not linked from anywhere and kept
// out of search indexes; the figures themselves come from /api/bmstats.
export const metadata: Metadata = {
  title: 'Server status · BATMatch',
  robots: { index: false, follow: false },
}

export default function BmStatsPage() {
  return (
    <div className="lb-page">
      <div className="bms-top">
        <Link href="/" className="pp-back">← Home</Link>
        <BmStatsThemeToggle />
      </div>
      <BmStats />
    </div>
  )
}
