import type { PlayerEventResult, PlayerIndex } from '@/lib/types'
import { readIndexCache } from '@/lib/player-index-cache'
import { readMeta } from '@/lib/tournament-meta'
import { getLevelOverrides } from '@/lib/tournament-level-overrides'
import { isoWeekString } from '@/lib/ranking/player-view'
import type { AddCtx } from '@/lib/ranking/projection-board'

/** Build the per-player events accessor and the tournament level/name/week
 *  context for the add side, from the live caches. Tournament name + date come
 *  straight from the index's per-tournament records; only the level needs a
 *  meta/override lookup. Bounded to the tournaments the cohort actually played. */
export async function buildProjectionContext(
  slugs: string[],
): Promise<{ eventsOf: (slug: string) => PlayerEventResult[]; addCtx: AddCtx }> {
  const index = (await readIndexCache('bat')) as PlayerIndex | null

  const eventsBySlug = new Map<string, PlayerEventResult[]>()
  const nameMap = new Map<string, string>()
  const weekMap = new Map<string, string | null>()
  const ids = new Set<string>()

  for (const slug of slugs) {
    const record = index?.players[slug]
    if (!record) continue
    const flat: PlayerEventResult[] = []
    for (const t of record.tournaments) {
      const idUpper = t.tournamentId.toUpperCase()
      ids.add(idUpper)
      if (!nameMap.has(idUpper)) nameMap.set(idUpper, t.tournamentName)
      if (!weekMap.has(idUpper)) {
        weekMap.set(idUpper, t.tournamentDateIso ? isoWeekString(new Date(t.tournamentDateIso)) : null)
      }
      for (const e of t.events) flat.push(e)
    }
    eventsBySlug.set(slug, flat)
  }

  const overrides = getLevelOverrides()
  const levelMap = new Map<string, number | undefined>()
  await Promise.all(Array.from(ids).map(async id => {
    const meta = await readMeta(id)
    levelMap.set(id, overrides.get(id) ?? meta?.level)
  }))

  const addCtx: AddCtx = {
    levelOf: id => levelMap.get(id.toUpperCase()),
    nameOf: id => nameMap.get(id.toUpperCase()) ?? '',
    weekOf: id => weekMap.get(id.toUpperCase()) ?? null,
  }
  return { eventsOf: slug => eventsBySlug.get(slug) ?? [], addCtx }
}
