'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import BracketCanvas from '@/components/BracketCanvas'
import EventBundleView from '@/components/EventBundleView'
import MatchSchedule from '@/components/MatchSchedule'
import PlayerModal from '@/components/PlayerModal'
import { exportBracketAsJpg } from '@/components/ExportButton'
import H2HModal from '@/components/H2HModal'
import CustomTabModal from '@/components/CustomTabModal'
import CustomTabButton from '@/components/CustomTabButton'
import Link from 'next/link'
import { useLongPress } from '@/lib/useLongPress'
import { usePointerReorder } from '@/lib/usePointerReorder'
import AnnouncementBanner from '@/components/AnnouncementBanner'
import StaleCacheBanner from '@/components/StaleCacheBanner'
import DiskCacheBadge from '@/components/DiskCacheBadge'
import {
  ANN_CUSTOM_TABS_MULTI,
  ANN_CUSTOM_TABS_MULTI_TEXT_TH,
} from '@/lib/announcements'
import AlertBell from '@/components/AlertBell'
import {
  getAlerts,
  dismissAlerts,
  recordTournamentSnapshot,
  recordScheduleSnapshot,
  recordRankingSnapshot,
  type AlertItem,
} from '@/lib/alerts'
import ScrollToTopButton from '@/components/ScrollToTopButton'
import {
  loadCustomTabs,
  addCustomTab,
  updateCustomTab,
  deleteCustomTab,
  reorderCustomTabs,
  MAX_CUSTOM_TABS,
  type CustomTab,
} from '@/lib/customTab'
import { useLanguage } from '@/lib/LanguageContext'
import { longRoundL } from '@/lib/i18n'
import { useTheme } from '@/lib/ThemeContext'
import { useLiveScore } from '@/lib/useLiveScore'
import { matchLiveCourt } from '@/lib/live-score'
import { setPersonProps, track } from '@/lib/analytics'
import { getTodayIso } from '@/lib/today'
import type { BracketData, ApiError, TournamentInfo, DrawInfo, MatchDay, MatchScheduleGroup, MatchesData, PlayerProfile, H2HData, MatchEntry, EventBundle, TournamentOverview, SeedEvent } from '@/lib/types'

function isApiError(data: unknown): data is ApiError {
  return typeof data === 'object' && data !== null && 'error' in data
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(res.ok ? 'Unexpected server response' : `Server error (${res.status}) — please try again`)
  }
}

// /api/matches stamps X-Stale-Cache: 1 when it served a cached copy because
// the BAT upstream was unreachable. Inspect once per successful response so
// the banner can flip on/off in real time without polling. Non-OK responses
// leave the prior signal alone — we don't have fresh data and don't want to
// pretend BAT is fine just because our route returned 500.
function readStaleFlag(res: Response): boolean | null {
  if (!res.ok) return null
  return res.headers.get('X-Stale-Cache') === '1'
}

// /api/matches and /api/draws stamp X-Cache-Source: disk when the response
// came from a durable disk pin (immutable past data — see DiskCacheBadge).
// Same null-on-error semantics as readStaleFlag so the badge doesn't flip
// off on a transient 500 that left the prior state genuine.
function readDiskCacheFlag(res: Response): boolean | null {
  if (!res.ok) return null
  return res.headers.get('X-Cache-Source') === 'disk'
}

// Background-fetches each future-day schedule so the day-tab dim/lit state
// reflects whether BAT has published matches for that date. Sequential to
// avoid a parallel burst; runs after first paint via requestIdleCallback.
// The /api/matches route caches future-day responses for 10 min, so across
// many visitors this collapses to ~96 BAT hits per future date per day.
function prefetchFutureDayHasMatches(
  tournamentId: string,
  days: MatchDay[],
  setDays: React.Dispatch<React.SetStateAction<MatchDay[]>>,
  onSnapshot: (next: MatchDay[]) => void,
  onStaleFlag: (stale: boolean) => void,
) {
  if (typeof window === 'undefined') return
  const todayIso = getTodayIso()
  const future = days.filter((d) => d.dateIso && d.dateIso > todayIso)
  if (future.length === 0) return

  const run = async () => {
    for (const d of future) {
      try {
        const res = await fetch(
          `/api/matches?tournament=${encodeURIComponent(tournamentId)}&date=${d.date}`,
        )
        const stale = readStaleFlag(res)
        if (stale !== null) onStaleFlag(stale)
        const data = await safeJson(res)
        if (!isApiError(data)) {
          const dayData = data as Pick<MatchesData, 'groups'>
          setDays((prev) => {
            const next = prev.map((x) =>
              x.date === d.date ? { ...x, hasMatches: dayData.groups.length > 0 } : x,
            )
            onSnapshot(next)
            return next
          })
        }
      } catch {}
    }
  }

  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number
  }
  const w = window as IdleWindow
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => { void run() }, { timeout: 2000 })
  } else {
    window.setTimeout(() => { void run() }, 0)
  }
}

type ViewMode = 'overview' | 'bracket' | 'matches' | 'live' | 'custom'

export default function Home() {
  const { lang, toggleLang, t } = useLanguage()
  const { theme, toggleTheme } = useTheme()
  const [tournaments, setTournaments] = useState<TournamentInfo[]>([])
  const [draws, setDraws] = useState<DrawInfo[]>([])
  const [selectedTournament, setSelectedTournament] = useState('')
  const [selectedDraw, setSelectedDraw] = useState('')
  const [bracketHtml, setBracketHtml] = useState('')
  const [eventBundle, setEventBundle] = useState<EventBundle | null>(null)
  // eventName → playoff drawNum, derived from `draws` once they load.
  // MatchSchedule uses this to deep-link round-robin matches into the bundle.
  const eventToPlayoffDrawNum: Record<string, string> = {}
  for (const d of draws) {
    if (d.isPlayoff && d.eventName) eventToPlayoffDrawNum[d.eventName] = d.drawNum
  }
  const [playerQuery, setPlayerQuery] = useState('')
  const [highlightResults, setHighlightResults] = useState(true)
  const [excludeCompleted, setExcludeCompleted] = useState(false)
  const [loadingTournaments, setLoadingTournaments] = useState(true)
  const [loadingDraws, setLoadingDraws] = useState(false)
  const [loadingBracket, setLoadingBracket] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tournamentName, setTournamentName] = useState('')
  const [drawName, setDrawName] = useState('')
  const [fromRound, setFromRound] = useState(0)
  const [fromRoundName, setFromRoundName] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('matches')
  const [customTabs, setCustomTabs] = useState<CustomTab[]>([])
  const [activeCustomTabId, setActiveCustomTabId] = useState<string | null>(null)
  const [customModalOpen, setCustomModalOpen] = useState(false)
  const [customModalMode, setCustomModalMode] = useState<'create' | 'edit'>('create')
  const [customModalEditId, setCustomModalEditId] = useState<string | null>(null)
  const [customTabsEditMode, setCustomTabsEditMode] = useState(false)
  const [overviewNotes, setOverviewNotes] = useState<string[]>([])
  const [seedEvents, setSeedEvents] = useState<SeedEvent[]>([])
  const [matchDays, setMatchDays] = useState<MatchDay[]>([])
  const [selectedDay, setSelectedDay] = useState('')
  const [matchGroups, setMatchGroups] = useState<MatchScheduleGroup[]>([])
  const [playerClubMap, setPlayerClubMap] = useState<Record<string, string>>({})
  const [modalProfile, setModalProfile] = useState<PlayerProfile | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [h2hData, setH2hData] = useState<H2HData | null>(null)
  const [h2hLoading, setH2hLoading] = useState(false)
  const bracketRef = useRef<HTMLDivElement>(null)
  const playerSearchRef = useRef<HTMLInputElement>(null)
  const lastScrollY = useRef(0)
  const pendingJumpRef = useRef<{ tournamentId: string; drawNum: string; roundName: string } | null>(null)
  const autoSelectedTournamentRef = useRef(false)
  const [headerVisible, setHeaderVisible] = useState(true)
  const [searchHelpOpen, setSearchHelpOpen] = useState(false)
  const [showPastTournaments, setShowPastTournaments] = useState(false)
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  // True when the most-recent /api/matches response carried X-Stale-Cache.
  // Cleared on the next successful response that doesn't carry the header.
  // See readStaleFlag() and StaleCacheBanner.
  const [staleCache, setStaleCache] = useState(false)
  // True when the most-recent /api/matches or /api/draws response carried
  // X-Cache-Source: disk (immutable past data served from durable pin).
  // See readDiskCacheFlag() and DiskCacheBadge.
  const [diskCache, setDiskCache] = useState(false)
  // Tracks { courtKey: matchId } from the SignalR feed so we can detect
  // when a previously-live match completes (court drops or matchId changes)
  // and refetch the schedule — the scrape doesn't auto-refresh.
  const prevLiveMatchIdsRef = useRef<Map<string, number>>(new Map())
  const liveRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const liveGate = matchGroups.some((g) => g.matches.some((m) => m.nowPlaying))
  const liveByCourt = useLiveScore(selectedTournament || null, liveGate)

  const liveGroups: MatchScheduleGroup[] = matchGroups
    .map((g) => {
      const matches = g.matches.filter((m) => matchLiveCourt(m, liveByCourt) !== null)
      if (g.type === 'time') return { type: 'time' as const, time: g.time, matches }
      return { type: 'court' as const, court: g.court, matches }
    })
    .filter((g) => g.matches.length > 0)
  const liveMatchCount = liveGroups.reduce((n, g) => n + g.matches.length, 0)
  const hasLiveData = liveMatchCount > 0

  useEffect(() => {
    if (viewMode === 'live' && !hasLiveData) setViewMode('matches')
  }, [viewMode, hasLiveData])

  // Refetch the day's matches whenever SignalR signals a match completion:
  // either a court drops out of the feed, or a court's matchId changes
  // (new match took the same court). Debounced so the scraper has time to
  // see the new state on the source site.
  useEffect(() => {
    const prev = prevLiveMatchIdsRef.current
    const next = new Map<string, number>()
    let completion = false
    liveByCourt.forEach((court, key) => {
      next.set(key, court.matchId)
      const prevId = prev.get(key)
      if (prevId !== undefined && prevId !== court.matchId) completion = true
    })
    prev.forEach((_id, key) => {
      if (!next.has(key)) completion = true
    })
    prevLiveMatchIdsRef.current = next
    if (!completion || !selectedTournament || !selectedDay || selectedDay === 'stats') return
    if (liveRefetchTimerRef.current) clearTimeout(liveRefetchTimerRef.current)
    liveRefetchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/matches?tournament=${encodeURIComponent(selectedTournament)}&date=${selectedDay}&fresh=1`)
        const stale = readStaleFlag(res)
        if (stale !== null) setStaleCache(stale)
        const data = await safeJson(res)
        if (!isApiError(data)) {
          const md = data as Pick<MatchesData, 'groups'>
          setMatchGroups(md.groups)
        }
      } catch { /* ignore — next completion will retry */ }
    }, 5000)
    return () => {
      if (liveRefetchTimerRef.current) {
        clearTimeout(liveRefetchTimerRef.current)
        liveRefetchTimerRef.current = null
      }
    }
  }, [liveByCourt, selectedTournament, selectedDay])


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      playerSearchRef.current?.focus()
      playerSearchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'd' && e.key !== 'D') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      const next = theme === 'dark' ? 'light' : 'dark'
      track('theme_changed', { from: theme, to: next })
      toggleTheme()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theme, toggleTheme])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('batbracket.highlightResults')
      if (stored === 'true' || stored === 'false') setHighlightResults(stored === 'true')
      // excludeCompleted intentionally does not persist; clear any legacy value
      localStorage.removeItem('batbracket.excludeCompleted')
      const past = localStorage.getItem('batbracket.showPastTournaments')
      if (past === 'true') setShowPastTournaments(true)
    } catch {}
    setCustomTabs(loadCustomTabs())
  }, [])

  useEffect(() => {
    setAlerts(getAlerts())
  }, [])

  // If the active custom tab is deleted out from under us, fall back to Matches.
  useEffect(() => {
    if (viewMode !== 'custom') return
    if (!activeCustomTabId) return
    if (customTabs.some((t) => t.id === activeCustomTabId)) return
    setViewMode('matches')
    setActiveCustomTabId(null)
  }, [viewMode, activeCustomTabId, customTabs])

  useEffect(() => {
    if (viewMode !== 'custom') return
    if (!activeCustomTabId) return
    track('custom_tab_viewed', { tournament_id: selectedTournament, tab_id: activeCustomTabId })
  }, [viewMode, selectedTournament, activeCustomTabId])

  // Upgrade the device-level PostHog person profile with a human-readable name
  // (the first custom tab's nickname) so the persons list shows the nickname
  // instead of the device UUID. Fires on initial load and on any tab mutation.
  useEffect(() => {
    if (customTabs.length === 0) return
    const top = customTabs[0]
    setPersonProps({ name: top.nickname, follows: top.keyword })
  }, [customTabs])

  useEffect(() => {
    document.body.classList.toggle('no-highlight', !highlightResults)
    return () => { document.body.classList.remove('no-highlight') }
  }, [highlightResults])

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY
      if (y <= 10) {
        setHeaderVisible(true)
      } else {
        setHeaderVisible(false)
      }
      lastScrollY.current = y
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Load tournament list on mount
  useEffect(() => {
    fetch('/api/tournaments')
      .then((r) => safeJson(r))
      .then((data) => {
        if (!isApiError(data)) {
          const list = data as TournamentInfo[]
          setTournaments(list)
          setAlerts(recordTournamentSnapshot(list))
        }
      })
      .catch(() => {})
      .finally(() => setLoadingTournaments(false))
  }, [])

  // Poll for new BAT ranking publication on mount. The endpoint is a tiny
  // JSON {publishDate, scrapedAt} — no big payload. recordRankingSnapshot
  // is bootstrap-aware: first call ever just seeds, doesn't alert.
  useEffect(() => {
    fetch('/api/ranking-meta')
      .then((r) => safeJson(r))
      .then((data) => {
        if (isApiError(data)) return
        const meta = data as { publishDate: string | null }
        setAlerts(recordRankingSnapshot(meta.publishDate))
      })
      .catch(() => {})
  }, [])

  // Re-fetch tournament list when the tab becomes visible after >=5min idle.
  // Catches newly-discovered tournaments without periodic polling.
  useEffect(() => {
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (document.visibilityState !== 'visible' || hiddenAt === 0) return
      const elapsed = Date.now() - hiddenAt
      hiddenAt = 0
      if (elapsed < 5 * 60 * 1000) return
      fetch('/api/tournaments')
        .then((r) => safeJson(r))
        .then((data) => {
          if (!isApiError(data)) {
            const list = data as TournamentInfo[]
            setTournaments(list)
            setAlerts(recordTournamentSnapshot(list))
          }
        })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Load draws + matches when tournament changes
  const handleTournamentChange = useCallback(async (id: string) => {
    setSelectedTournament(id)
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('selectedTournament', id)
      else localStorage.removeItem('selectedTournament')
    }
    setSelectedDraw('')
    setDraws([])
    setBracketHtml('')
    setError(null)
    setMatchDays([])
    setMatchGroups([])
    setSelectedDay('')
    setOverviewNotes([])
    setSeedEvents([])
    // Clear cache-source indicators so they don't flash the previous
    // tournament's state during the in-flight switch. The next response
    // will repopulate them from headers.
    setStaleCache(false)
    setDiskCache(false)
    setViewMode('matches')
    if (!id) return

    setLoadingDraws(true)
    setLoadingMatches(true)
    setPlayerClubMap({})
    const t = tournaments.find((t) => t.id === id)
    setTournamentName(t?.name ?? id)

    // Background: build player→club map from all brackets (non-blocking)
    fetch(`/api/clubs?tournament=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then((data: Record<string, string>) => { if (data && !('error' in data)) setPlayerClubMap(data) })
      .catch(() => {})

    // Fetch overview (notes + seeds) for BAT tournaments (non-BWF)
    const tournamentProvider = t?.provider
    if (tournamentProvider !== 'bwf') {
      fetch(`/api/overview?tournament=${encodeURIComponent(id)}`)
        .then(r => r.json())
        .then((data: TournamentOverview) => {
          if (data?.notes) setOverviewNotes(data.notes)
          if (data?.seedEvents) setSeedEvents(data.seedEvents)
        })
        .catch(() => {})
    }

    // safeJson eats the Response object — break apart both fetches so we can
    // inspect X-Stale-Cache before draining the body. Both /api/draws and
    // /api/matches now stamp the header when serving stale, so either one
    // can light up the StaleCacheBanner.
    const [drawsRes, matchesRes] = await Promise.allSettled([
      fetch(`/api/draws?id=${encodeURIComponent(id)}`),
      fetch(`/api/matches?tournament=${encodeURIComponent(id)}`),
    ])

    setLoadingDraws(false)
    setLoadingMatches(false)

    if (drawsRes.status === 'fulfilled') {
      const res = drawsRes.value
      const stale = readStaleFlag(res)
      if (stale !== null) setStaleCache(stale)
      const disk = readDiskCacheFlag(res)
      if (disk !== null) setDiskCache(disk)
      const data = await safeJson(res).catch(() => null)
      if (data == null) setError('Failed to load draws')
      else if (isApiError(data)) setError(data.error)
      else setDraws(data as DrawInfo[])
    } else {
      setError('Failed to load draws')
    }

    if (matchesRes.status === 'fulfilled') {
      const res = matchesRes.value
      const stale = readStaleFlag(res)
      if (stale !== null) setStaleCache(stale)
      const disk = readDiskCacheFlag(res)
      if (disk !== null) setDiskCache(disk)
      const matchesData = await safeJson(res).catch(() => null)
      if (matchesData && !isApiError(matchesData)) {
        const md = matchesData as MatchesData
        setMatchDays(md.days)
        setMatchGroups(md.groups)
        setSelectedDay(md.currentDate || md.days[0]?.date || '')
        const tname = t?.name ?? id
        setAlerts(recordScheduleSnapshot(id, tname, md.days))
        prefetchFutureDayHasMatches(
          id,
          md.days,
          setMatchDays,
          (next) => setAlerts(recordScheduleSnapshot(id, tname, next)),
          setStaleCache,
        )
        // The full-schedule endpoint skips sibling enrichment for speed. Refetch
        // the current day in the background to populate siblingPlayerIds (used
        // by the next-opponent highlight). No loading flicker.
        const currentDate = md.currentDate || md.days[0]?.date || ''
        if (currentDate) {
          fetch(`/api/matches?tournament=${encodeURIComponent(id)}&date=${currentDate}`)
            .then(async (res) => {
              const stale = readStaleFlag(res)
              if (stale !== null) setStaleCache(stale)
              return safeJson(res)
            })
            .then((data) => {
              if (!isApiError(data)) {
                setMatchGroups((data as Pick<MatchesData, 'groups'>).groups)
              }
            })
            .catch(() => {})
        }
      }
    }
  }, [tournaments])

  // Restore previously selected tournament from localStorage once the list is known
  useEffect(() => {
    if (autoSelectedTournamentRef.current) return
    if (loadingTournaments || tournaments.length === 0) return
    autoSelectedTournamentRef.current = true
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('selectedTournament')
    if (saved) {
      const match = tournaments.find((t) => t.id === saved)
      if (match) {
        if (match.done) setShowPastTournaments(true)
        handleTournamentChange(saved)
      }
    }
  }, [loadingTournaments, tournaments, handleTournamentChange])

  useEffect(() => {
    if (!selectedTournament) return
    const t = tournaments.find((x) => x.id === selectedTournament)
    track('tournament_opened', {
      tournament_id: selectedTournament,
      tournament_name: t?.name ?? '',
    })
  }, [selectedTournament, tournaments])

  const alertsShownTrackedRef = useRef(false)
  useEffect(() => {
    if (alerts.length === 0 || alertsShownTrackedRef.current) return
    const tournaments = alerts.filter((a) => a.kind === 'tournament').length
    const schedules = alerts.filter((a) => a.kind === 'schedule').length
    track('alert_shown', { count: alerts.length, tournaments, schedules })
    alertsShownTrackedRef.current = true
  }, [alerts])

  useEffect(() => {
    if (!selectedDraw) return
    const d = draws.find((x) => x.drawNum === selectedDraw)
    track('draw_opened', {
      tournament_id: selectedTournament,
      tournament_name: tournamentName,
      draw_id: selectedDraw,
      draw_name: d?.name ?? '',
    })
  }, [selectedDraw, draws, selectedTournament, tournamentName])

  const fetchBracketFrom = useCallback(async (tournamentId: string, drawNum: string, round: number) => {
    setLoadingBracket(true)
    setError(null)
    const params = new URLSearchParams({ tournament: tournamentId, event: drawNum })
    if (round > 0) params.set('fromRound', String(round))
    try {
      const res = await fetch(`/api/bracket?${params}`)
      const data = await safeJson(res) as BracketData | ApiError
      if (isApiError(data)) throw new Error(data.error)
      setBracketHtml(data.html)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoadingBracket(false)
    }
  }, [])

  const fetchEventBundle = useCallback(async (tournamentId: string, eventName: string) => {
    setLoadingBracket(true)
    setError(null)
    setEventBundle(null)
    setBracketHtml('')
    try {
      const res = await fetch(`/api/event-bundle?tournament=${encodeURIComponent(tournamentId)}&event=${encodeURIComponent(eventName)}`)
      const data = await safeJson(res) as EventBundle | ApiError
      if (isApiError(data)) throw new Error(data.error)
      setEventBundle(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoadingBracket(false)
    }
  }, [])

  // Load bracket when draw changes
  const handleDrawChange = useCallback(async (drawNum: string) => {
    setSelectedDraw(drawNum)
    setBracketHtml('')
    setEventBundle(null)
    setFromRound(0)
    setFromRoundName('')
    setError(null)
    if (!drawNum || !selectedTournament) return
    const d = draws.find((d) => d.drawNum === drawNum)
    setDrawName(d?.name ?? drawNum)
    if (d?.isPlayoff && d.eventName) {
      await fetchEventBundle(selectedTournament, d.eventName)
      return
    }
    await fetchBracketFrom(selectedTournament, drawNum, 0)
  }, [selectedTournament, draws, fetchBracketFrom, fetchEventBundle])

  const handleRoundClick = useCallback(async (roundIndex: number) => {
    if (!selectedTournament || !selectedDraw) return
    const newFrom = roundIndex === fromRound && fromRound > 0 ? 0 : roundIndex
    const label = bracketRef.current?.querySelector(`[data-round-index="${roundIndex}"]`)
    const roundName = label?.textContent ?? ''
    setFromRound(newFrom)
    setFromRoundName(newFrom > 0 ? roundName : '')
    await fetchBracketFrom(selectedTournament, selectedDraw, newFrom)
  }, [selectedTournament, selectedDraw, fromRound, fetchBracketFrom])

  // After bracketHtml updates, jump to the pending round if one was requested
  useEffect(() => {
    const jump = pendingJumpRef.current
    if (!jump || !bracketHtml) return
    pendingJumpRef.current = null
    const labels = bracketRef.current?.querySelectorAll<HTMLElement>('.bk-round-label')
    if (!labels) return
    const targetEn = longRoundL(jump.roundName, 'en')
    for (const label of Array.from(labels)) {
      const labelText = label.textContent?.trim() ?? ''
      if (longRoundL(labelText, 'en') === targetEn) {
        const idx = parseInt(label.getAttribute('data-round-index') ?? '-1', 10)
        if (idx > 0) {
          setFromRound(idx)
          setFromRoundName(labelText || jump.roundName)
          fetchBracketFrom(jump.tournamentId, jump.drawNum, idx)
        }
        return
      }
    }
  }, [bracketHtml, fetchBracketFrom])

  const handleOpenBracketAtRound = useCallback(async (drawNum: string, roundName: string) => {
    setViewMode('bracket')
    pendingJumpRef.current = { tournamentId: selectedTournament, drawNum, roundName }
    setSelectedDraw(drawNum)
    const d = draws.find((d) => d.drawNum === drawNum)
    setDrawName(d?.name ?? drawNum)
    setBracketHtml('')
    setFromRound(0)
    setFromRoundName('')
    setError(null)
    await fetchBracketFrom(selectedTournament, drawNum, 0)
  }, [selectedTournament, draws, fetchBracketFrom])

  const handlePlayerClick = useCallback(async (playerId: string) => {
    if (!selectedTournament) return
    setModalProfile(null)
    setModalLoading(true)
    try {
      const res = await fetch(`/api/player?tournament=${encodeURIComponent(selectedTournament)}&player=${encodeURIComponent(playerId)}`)
      const data = await safeJson(res) as PlayerProfile | ApiError
      if (!isApiError(data)) {
        setModalProfile(data)
        track('player_profile_viewed', {
          player_id: playerId,
          player_name: data.name,
          tournament_id: selectedTournament,
        })
      }
    } catch {}
    finally { setModalLoading(false) }
  }, [selectedTournament])

  // BWF has no /api/player implementation, so the modal would just spin.
  // Passing undefined also drops the .pm-player-link affordance everywhere.
  const playerClickHandler = tournaments.find((x) => x.id === selectedTournament)?.provider === 'bwf'
    ? undefined
    : handlePlayerClick

  const handleModalClose = useCallback(() => {
    setModalProfile(null)
    setModalLoading(false)
  }, [])

  const handleH2HClick = useCallback(async (h2hUrl: string, m: MatchEntry) => {
    const t = tournaments.find((x) => x.id === selectedTournament)
    track('h2h_viewed', {
      tournament_id: selectedTournament,
      tournament_name: t?.name ?? '',
      match_id: h2hUrl,
      team1_names: m.team1.map((p) => p.name),
      team2_names: m.team2.map((p) => p.name),
      team1_ids: m.team1.map((p) => p.playerId).filter(Boolean),
      team2_ids: m.team2.map((p) => p.playerId).filter(Boolean),
      event_id: m.eventId,
      draw: m.draw,
      draw_id: m.drawNum,
      round_name: m.round,
    })
    setH2hData(null)
    setH2hLoading(true)
    try {
      const res = await fetch(`/api/h2h?path=${encodeURIComponent(h2hUrl)}`)
      const data = await safeJson(res) as H2HData | ApiError
      if (!isApiError(data)) setH2hData(data)
    } catch {}
    finally { setH2hLoading(false) }
  }, [selectedTournament, tournaments])

  const handleH2HClose = useCallback(() => {
    setH2hData(null)
    setH2hLoading(false)
  }, [])

  const handleDayChange = useCallback(async (date: string) => {
    if (!selectedTournament) return
    setSelectedDay(date)
    if (date === 'stats') return
    setLoadingMatches(true)
    try {
      const res = await fetch(`/api/matches?tournament=${encodeURIComponent(selectedTournament)}&date=${date}`)
      const stale = readStaleFlag(res)
      if (stale !== null) setStaleCache(stale)
      const disk = readDiskCacheFlag(res)
      if (disk !== null) setDiskCache(disk)
      const data = await safeJson(res)
      if (!isApiError(data)) {
        const md = data as Pick<MatchesData, 'groups'>
        setMatchGroups(md.groups)
        setMatchDays(prev => {
          const next = prev.map(d =>
            d.date === date ? { ...d, hasMatches: md.groups.length > 0 } : d
          )
          const tname = tournaments.find((x) => x.id === selectedTournament)?.name ?? selectedTournament
          setAlerts(recordScheduleSnapshot(selectedTournament, tname, next))
          return next
        })
      }
    } catch {}
    finally { setLoadingMatches(false) }
  }, [selectedTournament, tournaments])

  const handleExport = useCallback(() => {
    if (!bracketRef.current) return
    exportBracketAsJpg({
      bracketEl: bracketRef.current,
      tournamentName,
      eventName: drawName,
    })
  }, [tournamentName, drawName])

  const loading = loadingBracket || loadingDraws

  const customTabStripRef = useRef<HTMLDivElement>(null)
  const openCustomTabEdit = (tabId: string) => {
    setCustomModalMode('edit')
    setCustomModalEditId(tabId)
    setCustomModalOpen(true)
  }
  useLongPress(customTabStripRef, {
    targetSelector: '.custom-tab-button',
    holdMs: 600,
    pressClass: 'custom-tab-button--pressing',
    readyClass: 'custom-tab-button--ready',
    onFire: (el) => {
      const id = el.dataset.customTabId
      if (id) openCustomTabEdit(id)
    },
  })

  usePointerReorder(customTabStripRef, {
    enabled: customTabsEditMode,
    targetSelector: '.custom-tab-button',
    getId: (el) => el.dataset.customTabId ?? null,
    onReorder: (fromId, toId) => {
      if (fromId === toId) return
      const filtered = customTabs.filter((tab) => tab.id !== fromId)
      const insertAt = filtered.findIndex((tab) => tab.id === toId)
      const dragged = customTabs.find((tab) => tab.id === fromId)
      if (!dragged || insertAt < 0) return
      const next = [...filtered.slice(0, insertAt), dragged, ...filtered.slice(insertAt)]
      reorderCustomTabs(next.map((tab) => tab.id))
      setCustomTabs(loadCustomTabs())
    },
  })

  return (
    <>
      {/* Top bar */}
      <div
        className="sticky top-0 z-50 bg-[var(--surface)] border-b border-[var(--border)] shadow-sm transition-transform duration-300"
        style={{ transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)' }}
      >
        <div className="flex items-end gap-3 px-5 py-2.5 flex-wrap">
          <div className="flex flex-col whitespace-nowrap mr-2">
            <span className="font-bold text-[var(--fg)]" style={{fontSize:'1.2rem',lineHeight:'2rem'}}>
              <span style={{color:'var(--brand-fg)'}}>{t('appTitle1')}</span> <span style={{color:'var(--red)'}}>{t('appTitle2')}</span> {t('appTitle3')}
            </span>
            <span className="text-[12px] text-[var(--muted)]">{t('appSubtitle')}</span>
          </div>

          {/* Tournament selector */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[14px] font-semibold uppercase tracking-wide" style={{ color: 'var(--red)' }}>
                {t('tournament')}
              </label>
              {tournaments.some((tn) => tn.done) && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !showPastTournaments
                    setShowPastTournaments(next)
                    try { localStorage.setItem('batbracket.showPastTournaments', String(next)) } catch {}
                  }}
                  className="text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg)] uppercase tracking-wide"
                >
                  {showPastTournaments ? `▾ ${t('hidePast')}` : `▸ ${t('showPast')}`}
                </button>
              )}
            </div>
            <select
              value={selectedTournament}
              onChange={(e) => handleTournamentChange(e.target.value)}
              disabled={loadingTournaments}
              className="border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs min-w-[220px] max-w-[350px] bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)] disabled:opacity-50"
            >
              <option value="">
                {loadingTournaments ? t('loading') : t('selectTournament')}
              </option>
              {tournaments.filter((tn) => !tn.done).map((tn) => (
                <option key={tn.id} value={tn.id}>{tn.name}</option>
              ))}
              {showPastTournaments && (() => {
                const past = tournaments.filter((tn) => tn.done)
                if (past.length === 0) return null
                const groups: Array<{ year: string; items: TournamentInfo[] }> = []
                for (const tn of past) {
                  const year = tn.startDateIso?.slice(0, 4) || ''
                  const last = groups[groups.length - 1]
                  if (last && last.year === year) last.items.push(tn)
                  else groups.push({ year, items: [tn] })
                }
                return groups.map((g) => (
                  <optgroup
                    key={g.year || 'undated'}
                    label={g.year ? `${t('pastEvents')} · ${g.year}` : t('pastEvents')}
                  >
                    {g.items.map((tn) => (
                      <option key={tn.id} value={tn.id}>{tn.name}</option>
                    ))}
                  </optgroup>
                ))
              })()}
            </select>
          </div>

          {/* Draw selector — only relevant in bracket view */}
          {viewMode === 'bracket' && (
            <div className="flex flex-col gap-1">
              <label className={`${lang === 'th' ? 'text-[12px]' : 'text-[10px]'} font-semibold text-[var(--muted)] uppercase tracking-wide`}>
                {t('draw')}
              </label>
              <select
                value={selectedDraw}
                onChange={(e) => handleDrawChange(e.target.value)}
                disabled={!selectedTournament || loadingDraws || draws.length === 0}
                className="border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs min-w-[160px] bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)] disabled:opacity-50"
              >
                <option value="">
                  {loadingDraws ? t('loading') : draws.length === 0 && selectedTournament ? t('noDraws') : t('selectDraw')}
                </option>
                {draws.map((d) => (
                  <option key={d.drawNum} value={d.drawNum}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Player search */}
          {viewMode !== 'custom' && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <label className={`${lang === 'th' ? 'text-[12px]' : 'text-[10px]'} font-semibold text-[var(--muted)] uppercase tracking-wide`}>
                {t('trackLabel')}
              </label>
              <span className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setSearchHelpOpen((o) => !o)}
                  onMouseEnter={() => setSearchHelpOpen(true)}
                  onMouseLeave={() => setSearchHelpOpen(false)}
                  aria-label={t('searchHelp')}
                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[var(--muted)] text-[9px] font-bold text-[var(--muted)] leading-none hover:bg-[var(--border)] hover:text-[var(--fg)] cursor-help"
                >?</button>
                {searchHelpOpen && (
                  <div className="absolute left-0 top-full mt-1 z-[60] w-[min(320px,calc(100vw-24px))] p-2.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] text-xs leading-relaxed shadow-lg normal-case tracking-normal font-normal">
                    {t('searchHelp')}
                  </div>
                )}
              </span>
            </div>
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
              <div className="relative min-w-[150px] shrink-0">
                <input
                  ref={playerSearchRef}
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={playerQuery}
                  onChange={(e) => setPlayerQuery(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-md pl-2.5 pr-7 py-1.5 text-xs bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)]"
                />
                {playerQuery && (
                  <button
                    type="button"
                    onClick={() => setPlayerQuery('')}
                    aria-label={t('clearSearch')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] text-[11px] leading-none"
                  >✕</button>
                )}
              </div>
              <label className="flex items-center gap-1 text-xs text-[var(--fg)] whitespace-nowrap cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={highlightResults}
                  onChange={(e) => {
                    const next = e.target.checked
                    setHighlightResults(next)
                    try { localStorage.setItem('batbracket.highlightResults', String(next)) } catch {}
                  }}
                  className="accent-yellow-400"
                />
                {t('highlight')}
              </label>
              <label className="flex items-center gap-1 text-xs text-[var(--fg)] whitespace-nowrap cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={excludeCompleted}
                  onChange={(e) => setExcludeCompleted(e.target.checked)}
                  className="accent-yellow-400"
                />
                {t('excludeCompleted')}
              </label>
            </div>
            {!selectedTournament && playerQuery.trim() && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {t('pleaseSelectTournament')}
              </div>
            )}
          </div>
          )}

          {/* Right-side controls: export (bracket only) + language toggle */}
          <div className="ml-auto flex items-center gap-2">
            <DiskCacheBadge visible={diskCache} />
            {viewMode === 'bracket' && (
              <button
                onClick={handleExport}
                disabled={!bracketHtml || loading}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
              >
                {t('exportJpg')}
              </button>
            )}
            <Link
              href="/leaderboards"
              title={t('leaderboards')}
              aria-label={t('leaderboards')}
              className="inline-flex items-center justify-center w-[30px] h-[28px] rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--fg)] text-sm"
            >🏆</Link>
            <AlertBell
              alerts={alerts}
              onDismiss={() => setAlerts(dismissAlerts())}
            />
            <button
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark'
                track('theme_changed', { from: theme, to: next })
                toggleTheme()
              }}
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              className="inline-flex items-center justify-center w-[30px] h-[28px] rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--fg)] text-sm"
              suppressHydrationWarning
            >
              {theme === 'dark' ? '☀' : '🌙'}
            </button>
            <button
              onClick={() => {
                const next = lang === 'en' ? 'th' : 'en'
                track('language_changed', { from: lang, to: next })
                toggleLang()
              }}
              aria-label="Toggle language"
              title={lang === 'en' ? 'เปลี่ยนเป็นภาษาไทย' : 'Switch to English'}
              className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--fg)] text-xs font-semibold overflow-hidden"
            >
              <span className={`px-2 py-1 ${lang === 'en' ? 'bg-[var(--brand)] text-white' : ''}`}>EN</span>
              <span className={`px-2 py-1 ${lang === 'th' ? 'bg-[var(--brand)] text-white' : ''}`}>TH</span>
            </button>
          </div>
        </div>
      </div>

      <StaleCacheBanner visible={staleCache} />

      <AnnouncementBanner
        id={ANN_CUSTOM_TABS_MULTI}
        text={ANN_CUSTOM_TABS_MULTI_TEXT_TH}
        visible={!!selectedTournament}
      />

      {/* View mode tabs */}
      {selectedTournament && (
        <div ref={customTabStripRef} className="flex items-center gap-0 px-[3px] py-0 bg-[var(--surface)] border-b border-[var(--border)]">
          {(overviewNotes.length > 0 || seedEvents.length > 0) && (
            <button
              onClick={() => setViewMode('overview')}
              className={`px-[5px] sm:px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                viewMode === 'overview'
                  ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              {t('overview')}
            </button>
          )}
          <button
            onClick={() => setViewMode('bracket')}
            className={`px-[5px] sm:px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              viewMode === 'bracket'
                ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            {t('bracket')}
          </button>
          <button
            onClick={() => setViewMode('matches')}
            className={`px-[5px] sm:px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              viewMode === 'matches'
                ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            {t('matchSchedule')}
            {loadingMatches && <span className="ml-1 opacity-50">…</span>}
          </button>
          {hasLiveData && (
            <button
              onClick={() => setViewMode('live')}
              className={`px-[5px] sm:px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                viewMode === 'live'
                  ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <span className="ms-live-badge">{t('live')}</span>
              {t('liveMatches')}
              <span className="opacity-70">({liveMatchCount})</span>
            </button>
          )}
          {customTabs.length > 0 && (
            <div className="mx-1.5 h-4 w-px bg-[var(--border)] shrink-0" aria-hidden="true" />
          )}
          {customTabs.map((tab) => (
            <CustomTabButton
              key={tab.id}
              tab={tab}
              active={viewMode === 'custom' && activeCustomTabId === tab.id}
              editMode={customTabsEditMode}
              onActivate={() => {
                setViewMode('custom')
                setActiveCustomTabId(tab.id)
              }}
              onEdit={() => openCustomTabEdit(tab.id)}
            />
          ))}
          {customTabs.length < MAX_CUSTOM_TABS && (
            <button
              onClick={() => {
                setCustomModalMode('create')
                setCustomModalEditId(null)
                setCustomModalOpen(true)
              }}
              aria-label={t('customTabAddTooltip')}
              title={t('customTabAddTooltip')}
              className="px-[5px] sm:px-3 py-2.5 text-xs font-semibold border-b-2 border-transparent text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >+</button>
          )}
          {customTabs.length > 0 && (
            <button
              onClick={() => setCustomTabsEditMode((v) => !v)}
              aria-label={customTabsEditMode ? t('customTabEditDone') : t('customTabEditTabs')}
              title={customTabsEditMode ? t('customTabEditDone') : t('customTabEditTabs')}
              className={`px-[5px] sm:px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                customTabsEditMode
                  ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >{customTabsEditMode ? '✓' : '✎'}</button>
          )}
        </div>
      )}

      {/* Hint banner (bracket view only) */}
      {viewMode === 'bracket' && (
        <div className="px-5 py-1.5 bg-[var(--info-bg)] border-b border-[var(--border)] text-xs text-[var(--info-fg)]">
          {t('bracketRoundHint')}
        </div>
      )}

      {/* Legend (bracket view only) */}
      {viewMode === 'bracket' && (
        <div className="flex gap-4 px-5 py-2 bg-[var(--surface)] border-b border-[var(--row-sep)] text-xs text-[var(--muted)]">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
            {t('winner')}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-300" />
            {t('notPlayed')}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-400" />
            {t('trackedPlayer')}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Overview view */}
      {viewMode === 'overview' && (
        <div className="px-5 py-5 max-w-4xl space-y-6">

          {/* Tournament Information */}
          {overviewNotes.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)] mb-3">
                {t('tournamentInformation')}
              </h2>
              {overviewNotes.map((html, i) => (
                <div
                  key={i}
                  className="mb-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ))}
            </section>
          )}

          {/* Seeded Entries */}
          {seedEvents.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)] mb-3">
                {t('seededEntries')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {seedEvents.map((ev, i) => (
                  <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                    <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
                      <span className="text-xs font-semibold text-[var(--fg)]">{ev.eventName}</span>
                    </div>
                    <div className="divide-y divide-[var(--row-sep)]">
                      {ev.seeds.map((entry) => (
                        <div key={entry.seed} className="flex items-baseline gap-2.5 px-3 py-1.5">
                          <span className="text-xs font-semibold text-[var(--muted)] w-4 shrink-0 text-right">{entry.seed}</span>
                          <span className="text-xs text-[var(--fg)]">{entry.players.join(' / ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      )}

      {/* Bracket view */}
      {viewMode === 'bracket' && (
        <>
          {!bracketHtml && !eventBundle && !loading && !error && (
            <div className="p-10 text-center text-[var(--muted)] text-sm">
              {!selectedTournament
                ? t('startPrompt')
                : !selectedDraw
                ? t('selectDrawPrompt')
                : t('loading')}
            </div>
          )}

          {loadingBracket && (
            <div className="p-10 text-center text-[var(--muted)] text-sm">
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-[-2px]" />
              {t('loadingBracket')}
            </div>
          )}

          {fromRound > 0 && bracketHtml && (
            <div className="flex items-center gap-2 px-5 py-1.5 bg-[var(--info-bg)] border-b border-[var(--border)] text-xs text-[var(--info-fg)]">
              <span>{t('viewingFrom')} <strong>{fromRoundName}</strong></span>
              <button
                onClick={() => handleRoundClick(0)}
                className="ml-1 underline hover:no-underline"
              >
                {t('showAllRounds')}
              </button>
            </div>
          )}

          {eventBundle && !loadingBracket && (
            <EventBundleView
              bundle={eventBundle}
              playerQuery={playerQuery}
              playerClubMap={playerClubMap}
              tournamentId={selectedTournament}
              onPlayerClick={playerClickHandler}
              onRoundClick={handleRoundClick}
              bracketRef={bracketRef}
            />
          )}
          {!eventBundle && bracketHtml && !loadingBracket && (
            <BracketCanvas
              bracketHtml={bracketHtml}
              playerQuery={playerQuery}
              bracketRef={bracketRef}
              onRoundClick={handleRoundClick}
              onPlayerClick={playerClickHandler}
              playerClubMap={playerClubMap}
            />
          )}
        </>
      )}

      {/* Matches view */}
      {viewMode === 'matches' && (
        <MatchSchedule
          groups={matchGroups}
          days={matchDays}
          selectedDay={selectedDay}
          onDayChange={handleDayChange}
          loading={loadingMatches}
          playerQuery={playerQuery}
          excludeCompleted={excludeCompleted}
          onEventClick={handleOpenBracketAtRound}
          eventToPlayoffDrawNum={eventToPlayoffDrawNum}
          playerClubMap={playerClubMap}
          onPlayerClick={playerClickHandler}
          onH2HClick={handleH2HClick}
          liveByCourt={liveByCourt}
          tournamentId={selectedTournament}
          tournamentName={tournamentName}
        />
      )}

      {/* Custom view */}
      {viewMode === 'custom' && activeCustomTabId && (() => {
        const active = customTabs.find((t) => t.id === activeCustomTabId)
        if (!active) return null
        return (
          <MatchSchedule
            groups={matchGroups}
            days={matchDays}
            selectedDay={selectedDay}
            onDayChange={handleDayChange}
            loading={loadingMatches}
            playerQuery={active.keyword}
            excludeCompleted={false}
            highlightMatches={false}
            onEventClick={handleOpenBracketAtRound}
            playerClubMap={playerClubMap}
            onPlayerClick={playerClickHandler}
            onH2HClick={handleH2HClick}
            liveByCourt={liveByCourt}
            tournamentId={selectedTournament}
            tournamentName={tournamentName}
          />
        )
      })()}

      {/* Live matches view */}
      {viewMode === 'live' && (
        <MatchSchedule
          groups={liveGroups}
          days={[]}
          selectedDay={selectedDay}
          onDayChange={handleDayChange}
          loading={loadingMatches}
          playerQuery={playerQuery}
          excludeCompleted={excludeCompleted}
          showJumpToNext={false}
          onEventClick={handleOpenBracketAtRound}
          playerClubMap={playerClubMap}
          onPlayerClick={playerClickHandler}
          onH2HClick={handleH2HClick}
          liveByCourt={liveByCourt}
          tournamentId={selectedTournament}
          tournamentName={tournamentName}
        />
      )}

      {/* Player profile modal */}
      {(modalLoading || modalProfile) && (
        <PlayerModal
          profile={modalProfile}
          loading={modalLoading}
          onClose={handleModalClose}
          onH2HClick={handleH2HClick}
          onPlayerClick={playerClickHandler}
          provider={tournaments.find((x) => x.id === selectedTournament)?.provider}
        />
      )}

      {/* H2H modal */}
      {(h2hLoading || h2hData) && (
        <H2HModal
          data={h2hData}
          loading={h2hLoading}
          onClose={handleH2HClose}
        />
      )}

      <CustomTabModal
        open={customModalOpen}
        mode={customModalMode}
        initial={
          customModalMode === 'edit' && customModalEditId
            ? customTabs.find((t) => t.id === customModalEditId) ?? null
            : null
        }
        onClose={() => setCustomModalOpen(false)}
        onSave={(input) => {
          if (customModalMode === 'create') {
            const created = addCustomTab(input)
            if (created) {
              const next = loadCustomTabs()
              setCustomTabs(next)
              setActiveCustomTabId(created.id)
              setViewMode('custom')
              track('custom_tab_created', {
                count: next.length,
                keyword_len: input.keyword.length,
                has_and: input.keyword.includes('&'),
                has_or: input.keyword.includes('|'),
              })
            }
          } else if (customModalEditId) {
            updateCustomTab(customModalEditId, input)
            setCustomTabs(loadCustomTabs())
            track('custom_tab_edited', {
              keyword_len: input.keyword.length,
              has_and: input.keyword.includes('&'),
              has_or: input.keyword.includes('|'),
            })
          }
          setCustomModalOpen(false)
        }}
        onDelete={
          customModalMode === 'edit' && customModalEditId
            ? () => {
                const idToDelete = customModalEditId
                deleteCustomTab(idToDelete)
                const remaining = loadCustomTabs()
                setCustomTabs(remaining)
                if (activeCustomTabId === idToDelete) {
                  setActiveCustomTabId(null)
                  setViewMode('matches')
                }
                setCustomModalOpen(false)
                track('custom_tab_deleted', { remaining: remaining.length })
              }
            : undefined
        }
      />

      <ScrollToTopButton />
    </>
  )
}
