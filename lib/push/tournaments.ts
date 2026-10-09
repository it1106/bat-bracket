import { listAllTournaments } from '@/lib/tournaments-registry'
import { loadDiscovered } from '@/lib/discovery-store'

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
