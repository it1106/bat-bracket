// Run with: npx tsx scripts/backfill-u15.ts
// Calls the backfill job directly (no token needed). Fills any missing/stale
// detail among the top-50 U15 cohort for the currently cached publication.
import { loadCohort, isCohortPlayerReady } from '@/lib/ranking/u15-cohort'
import { runDetailBackfill } from '@/lib/ranking/detail-backfill'
import { fetchAndCacheDetail } from '@/lib/ranking/fetch-detail'
import { writeRankingPlayerNotFound } from '@/lib/ranking/player-cache'

async function main() {
  const cohort = await loadCohort()
  if (!cohort) { console.error('no ranking cached'); process.exit(1) }
  console.log(`backfilling ${cohort.players.length} U15 players for ${cohort.publishDate}`)
  const result = await runDetailBackfill(cohort.players.map(p => p.globalPlayerId), {
    isReady: gid => isCohortPlayerReady(gid, cohort.publishDate),
    fetchDetail: gid => fetchAndCacheDetail('bat', gid, cohort.rankingId, cohort.publishDate),
    persistNotFound: gid => writeRankingPlayerNotFound('bat', gid, cohort.publishDate),
  })
  console.log(JSON.stringify(result, null, 2))
}
main()
