'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  lastSeenAnnouncement,
  markAnnouncementSeen,
  markNewTournamentsSeen,
  seenNewTournaments,
} from '@/lib/announcements'
import { track } from '@/lib/analytics'
import { PUB_TITLES, shortDate } from '@/lib/push/text'

// Two pop-ups, shown one after the other, each once per visitor:
//
// 1. The site owner's announcement, from /api/announcement. Its id is derived
//    from the text server-side, so editing it on /bmstats gives it a new id
//    and everyone sees it again.
// 2. Site news, from /api/tournament-news, in one card: tournaments the site
//    added by itself, and draws and schedules published for the first time,
//    over the last few days. Remembered per item, so tomorrow's news still
//    shows. Always in Thai, whatever the language switch says — it is written
//    for the site's Thai audience, and a first visit defaults to English.
//
// The owner's comes first when both are new. Every way of closing a pop-up
// counts as seen and is remembered — an Escape that didn't stick would leave
// it reappearing on every page load.

interface NewTournament { id: string; name: string }
interface Update {
  id: string
  kind: 'bracket' | 'schedule'
  tournamentId: string
  tournamentName: string
  items: string[]
}

type Item =
  | { kind: 'owner'; id: string; text: string }
  | { kind: 'news'; tournaments: NewTournament[]; updates: Update[] }

/** Items listed per update before "+อีก N". The push notification's limit. */
const ITEMS_SHOWN = 4

function parseOwner(data: unknown): Item | null {
  const a = (data as { announcement?: { id?: unknown; text?: unknown } | null } | null)?.announcement
  if (!a || typeof a.id !== 'string' || typeof a.text !== 'string' || !a.text) return null
  if (a.id === lastSeenAnnouncement()) return null
  return { kind: 'owner', id: a.id, text: a.text }
}

function parseNews(data: unknown): Item | null {
  const body = data as { tournaments?: unknown; updates?: unknown } | null
  const seen = seenNewTournaments()
  const tournaments = (Array.isArray(body?.tournaments) ? body.tournaments : []).filter(
    (t): t is NewTournament =>
      !!t && typeof t.id === 'string' && typeof t.name === 'string' && !!t.name && !seen.has(t.id),
  )
  const updates = (Array.isArray(body?.updates) ? body.updates : []).filter(
    (u): u is Update =>
      !!u && typeof u.id === 'string' && !seen.has(u.id) &&
      (u.kind === 'bracket' || u.kind === 'schedule') &&
      typeof u.tournamentId === 'string' && typeof u.tournamentName === 'string' && !!u.tournamentName &&
      Array.isArray(u.items) && u.items.length > 0 && u.items.every((i: unknown) => typeof i === 'string'),
  )
  return tournaments.length || updates.length ? { kind: 'news', tournaments, updates } : null
}

const newsIds = (item: Extract<Item, { kind: 'news' }>) =>
  [...item.tournaments.map((t) => t.id), ...item.updates.map((u) => u.id)]

function itemList(u: Update): string {
  const shown = u.items.slice(0, ITEMS_SHOWN).map((i) => (u.kind === 'schedule' ? shortDate(i, 'th') : i))
  const rest = u.items.length - shown.length
  return shown.join(', ') + (rest > 0 ? ` +อีก ${rest}` : '')
}

const linkFor = (id: string, name: string) =>
  `/?tournament=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`

const getJson = (url: string): Promise<unknown> =>
  fetch(url, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)

const textSize = 'text-[length:calc(14px*var(--text-scale))]'
const okClass = 'px-5 py-2 rounded-md bg-[var(--accent,#2563eb)] text-white font-semibold text-[length:calc(13px*var(--text-scale))] hover:opacity-90'

export default function AnnouncementPopup() {
  const pathname = usePathname()
  const [queue, setQueue] = useState<Item[]>([])
  const okRef = useRef<HTMLButtonElement | null>(null)

  // Not on /bmstats: the owner is editing the text there and shouldn't be
  // interrupted by their own announcement.
  const suppressed = (pathname ?? '').startsWith('/bmstats')

  useEffect(() => {
    if (suppressed) return
    let cancelled = false
    Promise.all([getJson('/api/announcement'), getJson('/api/tournament-news')]).then(([owner, news]) => {
      if (cancelled) return
      setQueue([parseOwner(owner), parseNews(news)].filter((x): x is Item => !!x))
    })
    return () => { cancelled = true }
  }, [suppressed])

  const shown = queue[0] ?? null

  const close = useCallback(() => {
    setQueue((current) => {
      const head = current[0]
      if (!head) return current
      if (head.kind === 'owner') {
        markAnnouncementSeen(head.id)
        track('announcement_dismissed', { id: head.id })
      } else {
        const ids = newsIds(head)
        markNewTournamentsSeen(ids)
        track('new_tournament_popup_dismissed', { ids })
      }
      return current.slice(1)
    })
  }, [])

  // The link is a full page load, so remember the pop-up before leaving.
  const open = useCallback((tournamentId: string, ids: string[]) => {
    markNewTournamentsSeen(ids)
    track('new_tournament_popup_opened', { id: tournamentId })
  }, [])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, close])

  useEffect(() => {
    if (!shown) return
    const id = window.setTimeout(() => okRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [shown])

  if (!shown || suppressed) return null

  if (shown.kind === 'owner') {
    return (
      <div className="pm-overlay" onClick={close}>
        <div className="pm-modal" role="dialog" aria-modal="true" aria-label="Announcement"
          onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
          <button className="pm-close" onClick={close} aria-label="ปิด">✕</button>
          <div className={`whitespace-pre-wrap pt-2 pb-1 ${textSize} leading-relaxed text-[var(--fg)]`}>
            {shown.text}
          </div>
          <div className="flex justify-end mt-4">
            <button ref={okRef} type="button" onClick={close} className={okClass}>OK</button>
          </div>
        </div>
      </div>
    )
  }

  const ids = newsIds(shown)
  const brackets = shown.updates.filter((u) => u.kind === 'bracket')
  const schedules = shown.updates.filter((u) => u.kind === 'schedule')
  const sections: Array<{ key: string; icon: string; title: string; rows: Array<{ key: string; id: string; name: string; detail?: string }> }> = [
    {
      key: 'tournament', icon: '🏸', title: PUB_TITLES.tournament.th,
      rows: shown.tournaments.map((t) => ({ key: t.id, id: t.id, name: t.name })),
    },
    {
      key: 'bracket', icon: '📋', title: PUB_TITLES.bracket.th,
      rows: brackets.map((u) => ({ key: u.id, id: u.tournamentId, name: u.tournamentName, detail: itemList(u) })),
    },
    {
      key: 'schedule', icon: '📅', title: PUB_TITLES.schedule.th,
      rows: schedules.map((u) => ({ key: u.id, id: u.tournamentId, name: u.tournamentName, detail: itemList(u) })),
    },
  ].filter((s) => s.rows.length > 0)
  const label = sections.length === 1 ? sections[0].title : 'ข่าวการแข่งขัน'

  return (
    <div className="pm-overlay" onClick={close}>
      <div className="pm-modal" role="dialog" aria-modal="true" aria-label={label} lang="th"
        onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <button className="pm-close" onClick={close} aria-label="ปิด">✕</button>
        <div className="pt-2 pb-1 space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {sections.map((s) => (
            <section key={s.key}>
              <h2 className="font-semibold text-[length:calc(15px*var(--text-scale))] text-[var(--fg)] mb-2 pr-6">
                {s.icon} {s.title}
              </h2>
              <ul className="space-y-2">
                {s.rows.map((r) => (
                  <li key={r.key} className={`flex items-center justify-between gap-3 ${textSize} text-[var(--fg)]`}>
                    <div className="min-w-0">
                      <div className="leading-snug">{r.name}</div>
                      {r.detail && (
                        <div className="leading-snug text-[length:calc(12px*var(--text-scale))] text-[var(--muted,#6b7280)]">
                          {r.detail}
                        </div>
                      )}
                    </div>
                    <a
                      href={linkFor(r.id, r.name)}
                      onClick={() => open(r.id, ids)}
                      className="shrink-0 px-3 py-1 rounded-md border border-[var(--accent,#2563eb)] text-[var(--accent,#2563eb)] font-semibold text-[length:calc(12px*var(--text-scale))] hover:opacity-80"
                    >
                      เปิดดู
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <button ref={okRef} type="button" onClick={close} className={okClass}>ตกลง</button>
        </div>
      </div>
    </div>
  )
}
