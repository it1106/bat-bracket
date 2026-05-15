# In-app alerts (header bell) — design

## Goal

Surface noteworthy tournament-data changes to a returning visitor through a small bell icon in the header. The bell pulses with a red dot when there are unseen changes; clicking it reveals what's new and dismisses the alert. State is per-device (localStorage) — no server-side notification system, no accounts.

## Scope

Two trigger events:
1. **New tournament added** — a non-`done` tournament appears in `/api/tournaments` that wasn't there last visit.
2. **New schedule published** — a *future* `dateIso` flips to `hasMatches=true` for any tournament the user has loaded match-days for.

Detection is app-wide for new tournaments and is limited by what the user has already loaded for schedule publication (we piggyback on the existing prefetch — no new endpoints).

Out of scope:
- Server-side push, email, or push notifications
- Cross-device sync
- Alerts for score changes, results, or `done` transitions
- Auto-navigation when an alert is tapped (informational only)

## User experience

- 90% of users are on mobile. The bell sits in the top-right cluster of the existing top bar (next to theme + language toggles), `36×36` touch target.
- When `pending.length === 0`: bell is muted, `aria-disabled`, click is a no-op.
- When `pending.length > 0`: bell uses the foreground color, red 8px dot at top-right, with a slow 2s `scale + opacity` pulsing ring around the dot. Pulse is disabled when `prefers-reduced-motion: reduce`.
- Clicking the bell opens a dropdown panel:
  - Desktop: anchored below-right of the bell, ~320px wide, scrollable up to 70vh.
  - Mobile: full-viewport-width sheet (`left: 8px; right: 8px`) below the header, with a soft backdrop, max-height 70vh.
  - Pulse stops while open.
- Items are grouped by kind ("New tournaments", "New Schedule Published") and are informational only — tapping any item, the backdrop, outside the panel, or pressing Escape dismisses **all** pending alerts and closes the panel.
- After dismiss, the bell returns to the muted/inert state.

i18n strings:

| key                    | EN                          | TH                            |
|------------------------|-----------------------------|-------------------------------|
| `alertsTitle`          | Notifications               | การแจ้งเตือน                  |
| `alertsNewTournaments` | New tournaments             | ทัวร์นาเมนต์ใหม่              |
| `alertsNewSchedule`    | New Schedule Published      | ประกาศเวลาแข่งใหม่            |
| `alertsBellAria`       | Notifications ({n} unread)  | การแจ้งเตือน ({n})            |

## Architecture

```
┌─ /api/tournaments ─────┐         ┌─ /api/matches?…&date=… ─┐
│ list of TournamentInfo │         │ days[].hasMatches       │
└──────────┬─────────────┘         └────────────┬────────────┘
           │                                    │
           ▼                                    ▼
       app/page.tsx ─── records snapshots ──► lib/alerts.ts
           │              (silent on first run)      │
           │                                         │
           │  alerts (useState)  ◄─── pending list ──┘
           ▼
   <AlertBell alerts={…} onDismiss={…} />     (header right side)
```

- `lib/alerts.ts` — pure module, owns localStorage I/O and detection. No React.
- `components/AlertBell.tsx` — presentational component. Bell + badge + pulse + dropdown.
- `app/page.tsx` — holds the `alerts` state and calls the snapshot functions at the existing fetch sites.

No React context, no global event bus, no new API routes.

## Data model

All keys live under the existing `batbracket.` namespace.

```ts
// Set on the very first record-call. Without this, first-visit changes are
// silent (we only seed snapshots on the bootstrap pass).
batbracket.alerts.bootstrapped: '1'

// tournamentId → metadata at last visit. Used to detect "new" entries.
// Done tournaments are stored too, but a transition from absent → present
// only fires an alert if !done at the time of detection.
batbracket.alerts.seenTournaments:
  Record<string, { name: string; done?: boolean }>

// For each tournamentId we've loaded match-days for, the future dateIso
// values that had hasMatches=true last time we looked.
batbracket.alerts.seenScheduleDays:
  Record<string, string[]>   // sorted, deduped, future-only

// Pending alerts not yet dismissed. Survives reloads.
batbracket.alerts.pending: AlertItem[]
```

```ts
type AlertItem =
  | { kind: 'tournament'
    ; id: string                    // `t:<tournamentId>`
    ; tournamentId: string
    ; tournamentName: string
    ; addedAt: string               // ISO-8601
    }
  | { kind: 'schedule'
    ; id: string                    // `s:<tournamentId>:<dateIso>`
    ; tournamentId: string
    ; tournamentName: string
    ; dateIso: string
    ; addedAt: string
    }
```

The deterministic `id` makes detection idempotent — we never push a second copy of an alert that's already pending. The `pending` array is hard-capped at **50 items** (FIFO drop) so a long-absent user can't accumulate unbounded state.

## Detection rules

- **New tournament**: any incoming `t.id` not in `seenTournaments` AND `t.done !== true` → push `tournament` alert. Tournaments that already exist with a different `name` do not fire (rename ≠ new). After detection, write the full incoming list back to `seenTournaments`.
- **New schedule**: filter incoming `MatchDay[]` to entries where `dateIso > todayIso` and `hasMatches === true`. Any such `dateIso` not already in `seenScheduleDays[tournamentId]` → push `schedule` alert. Today and past days are skipped (not "news"). After detection, merge new dates into `seenScheduleDays[tournamentId]`.
- **Bootstrap**: if `bootstrapped` is unset, both functions seed the snapshot, set `bootstrapped='1'`, and return `pending` unchanged. This guarantees first-ever visit is silent.

## Wiring (call sites in `app/page.tsx`)

1. **After `/api/tournaments` resolves** (existing `useEffect`, ~line 289):
   ```ts
   .then((data) => {
     if (!isApiError(data)) {
       const list = data as TournamentInfo[]
       setTournaments(list)
       setAlerts(recordTournamentSnapshot(list))
     }
   })
   ```

2. **`handleTournamentChange`** (~line 344) — after `setMatchDays(md.days)`:
   ```ts
   setAlerts(recordScheduleSnapshot(id, md.days))
   ```
   Also after the background sibling-enrichment refetch where `setMatchGroups` is called — but that endpoint doesn't return `days`, so we only re-snapshot once per tournament selection.

3. **`prefetchFutureDayHasMatches`** (~line 55) — pass a `setAlerts` callback through. Each iteration that flips a `hasMatches` flag calls `recordScheduleSnapshot(tournamentId, updatedDays)` with the post-update day list.

4. **`handleDayChange`** (~line 528) — after the per-day `hasMatches` update, call `recordScheduleSnapshot` with the updated day list.

5. **Tab visibility refresh**: a top-level `useEffect` adds a `visibilitychange` listener. When the tab becomes visible after being hidden ≥5 minutes, re-fetch `/api/tournaments` (which re-runs the snapshot via #1). No periodic polling.

## Component contract — `AlertBell`

```ts
interface AlertBellProps {
  alerts: AlertItem[]
  onDismiss: () => void
}
```

`onDismiss` is wired to a page-level handler that calls `dismissAlerts()` (clears `pending`, returns `[]`) and then `setAlerts([])`. Internally `AlertBell` manages only the open/closed dropdown state. It performs no localStorage access itself, which keeps `lib/alerts.ts` the single source of truth.

Pulse class is conditionally applied based on `alerts.length > 0 && !open`. When the dropdown opens, the pulse is removed (animation stops cleanly).

Locale formatting (e.g., "Sun, May 12") uses the existing `useLanguage()` context to choose between English and Thai date formats. Reuse helpers from `lib/i18n.ts` if a date formatter exists; otherwise add a small `formatAlertDate(dateIso, lang)` next to the component.

## Analytics

Three PostHog events via the existing `track(...)` helper:

| event              | properties                                                       |
|--------------------|------------------------------------------------------------------|
| `alert_shown`      | `{ count, tournaments, schedules }` — fires once per session when `pending` becomes non-empty |
| `alert_opened`     | `{ count, tournaments, schedules }` — fires on bell click        |
| `alert_dismissed`  | `{ count, tournaments, schedules, via: 'item'\|'outside'\|'escape' }` |

`alert_shown` should not double-fire on every render — guard with a ref similar to `AnnouncementBanner`'s `shownTracked` pattern.

## Error handling

- All localStorage reads/writes wrap in `try/catch` (matches `lib/announcements.ts` and `lib/customTab.ts`). Failures degrade silently — bell stays empty, app keeps working.
- Disabled storage / quota errors → detection is a no-op; no alerts ever appear, but no exceptions propagate.
- Corrupted JSON in any of the four keys → catch parse error, delete that single key, re-bootstrap on the next call. Other keys are unaffected.
- SSR safety: every exported function in `lib/alerts.ts` short-circuits on `typeof window === 'undefined'` and returns `[]` / no-ops. The `AlertBell` renders the muted/inert state on the server, then `useEffect` hydrates real state. No hydration mismatch.

## Testing

**Unit tests** (`__tests__/alerts.test.ts`):
- Bootstrap path: first call seeds snapshot, returns `[]`.
- New-tournament detection: `done=false` triggers; `done=true` does not; rename does not.
- Schedule detection: future-day flip triggers; today/past-day flip does not; `hasMatches=false` does not.
- Idempotency: re-running with the same data does not duplicate `pending`.
- `dismissAlerts()` clears `pending` but preserves both snapshot keys.
- 50-item cap: 51st alert evicts the oldest.
- SSR safety: every exported function returns empty / no-ops when `window` is undefined.
- Corrupted JSON in each key: handled, key cleared, no throw.

**Component tests** (`__tests__/AlertBell.test.tsx`):
- Empty alerts → bell is `aria-disabled`, no badge, no pulse class.
- Non-empty alerts → bell is enabled, dot is rendered, pulse class is present.
- Click bell → dropdown opens, pulse class is removed.
- Click item / outside / Escape → `onDismiss` called once.
- `prefers-reduced-motion: reduce` → pulse class still applied (CSS handles it), no animation observed.

**Manual QA**:
- iOS Safari + Android Chrome: dropdown sheet width, backdrop dismissal, touch target.
- Desktop Chrome + Firefox: anchored dropdown, outside-click dismissal, Escape.
- Pulse appearance with reduced motion enabled.
- localStorage cleared between runs to confirm bootstrap-silence.

## Open follow-ups (deliberately deferred)

- Auto-navigate / pre-select the alerted tournament on item tap.
- Server-side detection of schedule publications for tournaments the user has never loaded (would require a new `/api/published-days` route).
- Per-tournament follow / unfollow filtering.

These are explicitly out of scope for this design but are easy to add on top of the current data model later.
