import { readFileSync } from 'fs'
import { join } from 'path'
import { listAllTournaments } from '@/lib/tournaments-registry'
import { loadDiscovered } from '@/lib/discovery-store'
import { mergeForApi } from '@/lib/tournaments-merge'
import { parseTournamentsTxt } from '@/lib/tournaments-txt'

/** The BAT tournaments match alerts can be followed in, by upper-case id:
 *  those listed by hand in public/tournaments.txt (the registry) and those
 *  the site found by itself (the discovery store), which is how most live
 *  tournaments arrive. `done` is the hand-set finished flag.
 *
 *  The registry alone will not do — it leaves discovered tournaments out, and
 *  its resolveRef treats any unknown id as BAT. An id that is in neither list
 *  is nobody's tournament, and the watcher must never be made to ask for it. */
export async function alertTournaments(): Promise<Map<string, { done: boolean }>> {
  const out = new Map<string, { done: boolean }>()
  const notBat = new Set<string>()
  for (const t of listAllTournaments()) {
    const id = t.id.toUpperCase()
    if (t.provider === 'bat') out.set(id, { done: !!t.done })
    else notBat.add(id)
  }
  const found = await loadDiscovered().catch(() => null)
  for (const e of found?.entries ?? []) {
    const id = e.id.toUpperCase()
    // The hand-listed entry decides for a tournament in both lists.
    if (!e.hasBracket || out.has(id) || notBat.has(id)) continue
    out.set(id, { done: false })
  }
  return out
}

/** Every BAT tournament the site shows, with the name a notification should
 *  use — the same list `/api/tournaments` serves, through the same
 *  `mergeForApi`, so a publication never names a tournament the reader cannot
 *  open. That matters twice over: `mergeForApi` keeps a discovered entry only
 *  once its draws are out, and it drops anything `tournaments.txt` denies by
 *  id or by name pattern.
 *
 *  `alertTournaments` cannot serve this: it carries no names. The auto-done
 *  flag the route derives from the pinned day cache is not reproduced here —
 *  a tournament whose last day has passed simply stops publishing anything,
 *  and the hand-set `done` is honoured. */
export async function publicationTournaments(): Promise<Array<{ id: string; name: string; done: boolean }>> {
  let txt: ReturnType<typeof parseTournamentsTxt>
  try {
    txt = parseTournamentsTxt(readFileSync(join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8'))
  } catch {
    // No list, nothing to publish about. The next pass tries again.
    return []
  }
  const discovered = await loadDiscovered().catch(() => ({ version: 1 as const, entries: [] }))
  return mergeForApi(txt.manualEntries, txt.denySet, discovered, txt.denyNamePatterns)
    .filter((e) => !e.provider || e.provider === 'bat')
    .map((e) => ({ id: e.id.toUpperCase(), name: e.name, done: e.done === true }))
}
