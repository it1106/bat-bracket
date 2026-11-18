import { promises as fs } from 'fs'
import path from 'path'
import type { Publication } from './push/types'

// Draws and schedules the site saw published for the first time, for the
// pop-up (components/AnnouncementPopup.tsx). Written by the push publication
// pass (lib/push/publications.ts), which already decides each of these exactly
// once, on the leader, from a seeded baseline — so a deploy or a tournament's
// first sighting records nothing here either. New tournaments are not kept
// here: discovery's `promotedAt` covers those (lib/tournament-news.ts).
//
// Lives in .cache/site-news.json, outside Git, and is read by every worker.

export type NewsKind = 'bracket' | 'schedule'

export interface NewsEvent {
  /** Stable, unique per event: what each browser remembers having seen. */
  id: string
  kind: NewsKind
  /** Upper-case GUID. */
  tournamentId: string
  tournamentName: string
  /** Draw names for `bracket`, ISO dates for `schedule`. */
  items: string[]
  at: string
}

export interface SiteNews {
  version: 1
  events: NewsEvent[]
}

/** Kept on disk this long; the pop-up's own window is shorter. */
const KEEP_MS = 7 * 86_400_000
const KEEP_MAX = 200

const FILE_PATH = () => path.join(process.cwd(), '.cache', 'site-news.json')

const LETTER: Record<NewsKind, string> = { bracket: 'b', schedule: 's' }

/** The events a pass's publications add. Pure. */
export function newsEventsFrom(publications: readonly Publication[], nowIso: string): NewsEvent[] {
  const out: NewsEvent[] = []
  for (const p of publications) {
    if (p.kind !== 'bracket' && p.kind !== 'schedule') continue
    if (p.items.length === 0) continue
    out.push({
      id: `${LETTER[p.kind]}:${p.tournamentId}:${nowIso}`,
      kind: p.kind,
      tournamentId: p.tournamentId,
      tournamentName: p.tournamentName,
      items: p.items.slice(),
      at: nowIso,
    })
  }
  return out
}

/** Adds events and drops old ones. Pure. */
export function appendNews(news: SiteNews, events: readonly NewsEvent[], now: number): SiteNews {
  const ids = new Set(events.map((e) => e.id))
  const kept = news.events.filter((e) => !ids.has(e.id) && now - Date.parse(e.at) <= KEEP_MS)
  return { version: 1, events: [...kept, ...events].slice(-KEEP_MAX) }
}

function isEvent(e: unknown): e is NewsEvent {
  const x = e as NewsEvent
  return !!x && typeof x.id === 'string' && (x.kind === 'bracket' || x.kind === 'schedule') &&
    typeof x.tournamentId === 'string' && typeof x.tournamentName === 'string' &&
    Array.isArray(x.items) && x.items.every((i) => typeof i === 'string') && typeof x.at === 'string'
}

export async function loadNews(): Promise<SiteNews> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE_PATH(), 'utf8')) as { version?: unknown; events?: unknown }
    if (parsed?.version === 1 && Array.isArray(parsed.events)) {
      return { version: 1, events: parsed.events.filter(isEvent) }
    }
  } catch {}
  return { version: 1, events: [] }
}

/** Records a pass's publications. Never throws: a news file that cannot be
 *  written must not stop notifications going out. */
export async function recordNews(publications: readonly Publication[], now: number): Promise<void> {
  const events = newsEventsFrom(publications, new Date(now).toISOString())
  if (events.length === 0) return
  const file = FILE_PATH()
  const tmp = `${file}.${process.pid}.tmp`
  try {
    const next = appendNews(await loadNews(), events, now)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(next, null, 1), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    console.warn('[site-news] write failed:', err instanceof Error ? err.message : err)
    await fs.unlink(tmp).catch(() => {})
  }
}
