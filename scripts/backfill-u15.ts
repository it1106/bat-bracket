// Run with: npx tsx scripts/backfill-u15.ts
// Fills any missing/stale detail among the top-50 U15 cohort for the currently
// cached publication. Same runner the API route and scheduler hook use.
import { runU15Backfill } from '@/lib/ranking/u15-backfill'

async function main() {
  const result = await runU15Backfill()
  if ('error' in result) { console.error(result.error); process.exit(1) }
  console.log(JSON.stringify(result, null, 2))
}
main()
