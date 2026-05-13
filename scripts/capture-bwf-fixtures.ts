// scripts/capture-bwf-fixtures.ts
// Run with: npx tsx scripts/capture-bwf-fixtures.ts
// Captures JSON fixtures from BWF API for tournament 5726.
// Writes to *.real.json to avoid overwriting hand-crafted test fixtures.

import fs from 'fs'
import path from 'path'
import { primeIfNeeded } from '@/lib/providers/bwf/cf-context'
import {
  fetchTournamentDetail,
  fetchTournamentDraws,
  fetchTournamentDrawData,
  fetchDayMatches,
} from '@/lib/providers/bwf/api-client'

const TMT_ID = 5726
const TOURNAMENT_CODE = '6E65C36E-497D-42D2-8F4E-78A2D30D9893'
const DRAW_ID = '11'
const DATE = '2026-05-19'
const OUT = path.join(process.cwd(), 'fixtures', 'bwf')

async function main() {
  await primeIfNeeded()
  fs.mkdirSync(OUT, { recursive: true })

  const detail = await fetchTournamentDetail({ tmtId: TMT_ID })
  fs.writeFileSync(path.join(OUT, 'tournament-detail.real.json'), JSON.stringify(detail, null, 2))
  console.log('captured tournament-detail.real.json')

  const draws = await fetchTournamentDraws({ tmtId: TMT_ID })
  fs.writeFileSync(path.join(OUT, 'tournament-draws.real.json'), JSON.stringify(draws, null, 2))
  console.log('captured tournament-draws.real.json')

  const drawData = await fetchTournamentDrawData({ tmtId: TMT_ID, drawId: DRAW_ID })
  fs.writeFileSync(path.join(OUT, 'tournament-draw-data.real.json'), JSON.stringify(drawData, null, 2))
  console.log('captured tournament-draw-data.real.json')

  const day = await fetchDayMatches({ tournamentCode: TOURNAMENT_CODE, date: DATE })
  fs.writeFileSync(path.join(OUT, 'day-matches.real.json'), JSON.stringify(day, null, 2))
  console.log('captured day-matches.real.json')
}

main().catch((err) => { console.error(err); process.exit(1) })
