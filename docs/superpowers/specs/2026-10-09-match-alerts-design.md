# Match Alerts (web push)

**Date:** 2026-10-09

## Summary

A person follows a player in a tournament and gets a notification on their
phone or computer when that player's match is close to going on court: once at
about three matches away, and once when it is next. The alert arrives when
BATMatch is closed and the phone is locked.

It is for parents, coaches and players at a tournament who cannot keep the
schedule open all day and do not want to miss a call to court.

Concrete example: a parent follows their child in BS U15. While they are having
lunch outside the hall, the phone shows "About 3 matches away: Anan Dee vs Beam
Kla · BS U15 R32 · Court 4". Some minutes later: "Up next: Anan Dee vs Beam
Kla · BS U15 R32 · Court 4". Tapping either opens BATMatch on that day's
schedule.

## Decisions already made

- **Moment:** "your player is about to play". Results and schedule changes are
  not part of this version.
- **Channel:** web push. No LINE, no email.
- **Follow unit:** an individual player in one tournament.
- **Trigger:** two alerts per match, at about three matches away and at next.

## Scope

- **In scope:** BAT tournaments. Time-slot schedules (the ones that already
  show "Up next" / "N away" pills). Thai and English. Android, desktop
  browsers, and iPhone once BATMatch is on the home screen.
- **Out of scope:** BWF tournaments. Court-sequenced days ("followed by"
  schedules), which have no queue position today. Following a club or a
  keyword. Result, schedule-change and ranking alerts. A user-chosen lead
  time. Accounts or syncing follows between devices. LINE.

## What the server knows, and what it does not

- Today's schedule for each active tournament is re-read by a background job
  every 4 minutes (`warmTick` in `instrumentation.ts`), and at most once a
  minute while a day in play is being viewed (`app/api/matches/route.ts`,
  60-second in-memory entry).
- Live court scores go from BAT's live feed straight to each visitor's
  browser (`lib/live-score.ts`). The server never sees them. It knows only
  what the schedule page says: which matches have a winner and which are
  marked now playing.

So the server's queue position is `computePlayingOrder({ groups, liveByCourt:
null })` (`lib/playingOrder.ts`): the same rule the pills use, without the
live-court refinement. It is an estimate, and the alert text says "about".

## Architecture

Five pieces. The follow list and the alert decision do not know how an alert
is delivered, so a second channel can be added later without touching them.

1. **Service worker** (`public/sw.js`) — receives a push, shows the
   notification, opens BATMatch when it is tapped. Nothing else: it does not
   cache pages or assets, so it can never serve a stale app.
2. **Subscription store** (`lib/push/store.ts`) — the devices that asked for
   alerts and the players each one follows, in a file under `.cache/push/`.
3. **API** (`app/api/push/*`) — subscribe, follow, unfollow, read back.
4. **Alert decision** (`lib/push/alerts.ts`) — pure: given a day's schedule,
   the follows and what was already sent, which alerts are due.
5. **Watcher** (`lib/push/watcher.ts`, started from `instrumentation.ts`) —
   once a minute, for tournaments with followers and matches today, gets the
   schedule, asks the decision, sends, records.

One new dependency: `web-push`, to sign and encrypt pushes.

## Data

### Subscription store

`.cache/push/subscriptions.json`, written atomically (temp file, rename), one
writer at a time through a promise chain like the other caches.

```ts
interface PushFollow {
  tournamentId: string      // upper-case GUID
  playerId: string          // BAT's tournament-local player id
  playerName: string        // as shown when followed, for the list
  addedAt: string           // ISO
}

interface PushSubscriptionRecord {
  endpoint: string          // the push service address; the record's key
  keys: { p256dh: string; auth: string }
  lang: 'en' | 'th'
  follows: PushFollow[]
  createdAt: string
  lastSeenAt: string        // refreshed whenever the device talks to the API
}
```

Limits: 50 follows per device, 5,000 devices. A request past either is
refused with 429. A record with no follows is deleted. A record not seen for
60 days is deleted by the watcher.

### Sent log

`.cache/push/sent.json`: one entry per alert already sent, so each fires once.

```ts
// key: `${endpoint hash}|${tournamentId}|${dateIso}|${matchKey}|${stage}`
type Stage = 'soon' | 'next'
```

`matchKey` is the match's sorted player ids joined with a comma, plus the draw
number: stable across re-reads of the schedule, unlike its position in the
list. Entries for a day older than yesterday are dropped.

### Keys and settings

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:`) in
the environment, documented in `.env.example` and `DEPLOY.md`. With any of
them missing the feature is off: the follow button is not shown and the
watcher does not start. The public key is served by `GET /api/push/key`.

## API

All under `/api/push`. Bodies are JSON. The device is identified by its push
endpoint, which only that browser and the push service know.

| Route | Does |
|-------|------|
| `GET /key` | `{ publicKey }`, or 404 when the feature is off |
| `POST /follow` | `{ subscription, lang, tournamentId, playerId, playerName }` → creates the record if new, adds the follow; returns the device's follows |
| `POST /unfollow` | `{ endpoint, tournamentId, playerId }` → removes it; deletes the record when none are left |
| `POST /state` | `{ endpoint }` → the device's follows, and refreshes `lastSeenAt` |

Validation: `endpoint` must be an `https:` URL on a known push service host
(`fcm.googleapis.com`, `*.push.apple.com`, `updates.push.services.mozilla.com`,
`*.notify.windows.com`); `tournamentId` a GUID of a BAT tournament the
registry knows; `playerId` digits; `playerName` at most 120 characters. This
keeps the server from being told to send requests to arbitrary addresses.

## Alert decision

```ts
interface DueAlert {
  endpoint: string
  stage: 'soon' | 'next'
  sentKey: string
  match: MatchEntry
  followed: PushFollow[]     // which of this device's players are in the match
}

function dueAlerts(input: {
  tournamentId: string
  dateIso: string
  groups: MatchScheduleGroup[]
  records: PushSubscriptionRecord[]
  alreadySent: (key: string) => boolean
}): DueAlert[]
```

Rules:

- Queue positions come from `computePlayingOrder({ groups, liveByCourt: null })`.
- A followed player's match at position 1 is due stage `next`. At position 2,
  3 or 4 it is due stage `soon` ("about three away" covers a small range, so a
  one-minute check cannot step over it).
- A match with a winner, a walkover, or marked now playing is never due.
- A match first seen at position 1 sends `next` only; `soon` is then recorded
  as sent without sending, so it cannot arrive afterwards.
- Two followed players in the same match produce one alert naming both.
- A match with no queue position (a court-sequenced day) is never due.

## Watcher

Started once from `instrumentation.ts`, gated by the existing leader lease so
only one worker ever sends. Every 60 seconds:

1. Skip entirely when there are no records, or when `batDownSince()` says BAT
   is in an outage (the schedule would be stale).
2. Group follows by tournament. For each tournament with a schedule day for
   today, get that day through the app's own matches route
   (`/api/matches?tournament=…&date=…`, no `fresh=1`), so it shares the
   one-minute cache with visitors and the 4-minute warmer.
3. Run `dueAlerts`, send each through the sender, record what was sent.
4. A push the service answers 404 or 410 for: delete that record.
5. Any other send failure is logged and not recorded as sent, so the next
   tick retries it; after 3 failed ticks for one alert (counted in memory) it
   is recorded as sent and dropped.

Cost: no BAT request when someone is already viewing the day; otherwise at
most one schedule request a minute for each followed tournament in play.
Tournaments nobody follows cost nothing.

The sender is an interface (`send(record, payload) → 'ok' | 'gone' | 'failed'`)
with one implementation over `web-push`, so tests use a fake and a second
channel can be added beside it. Pushes are sent with high urgency and a
10-minute time to live: an alert that cannot be delivered within ten minutes
is no longer useful.

## Notification

Payload: `{ title, body, url, tag }`. Text is built on the server in the
device's language.

| Stage | English | Thai |
|-------|---------|------|
| `soon` | About {n} matches away | อีกประมาณ {n} คู่ |
| `next` | Up next | คู่ต่อไป |

`{n}` is the match's queue position minus one when the alert is sent, so the
title never claims more precision than the schedule gives.

Body: `{player} vs {opponent} · {draw} {round} · {court}`; court is left out
when the schedule has none. `tag` is the match key, so `next` replaces `soon`
for the same match on the device. `url` opens `/` on that tournament and day.

## UI

### Follow button

In `components/PlayerModal.tsx`, beside the player's name: a bell that reads
"Follow" or "Following". Shown only for BAT tournaments, when the feature is
on, and when the browser supports push.

- First tap: the browser's notification permission prompt, then subscribe and
  follow. The prompt is never shown on page load.
- Permission denied: the button explains that notifications are blocked for
  this site and how to allow them in the browser's site settings.
- **iPhone, not installed:** the button explains that alerts need BATMatch on
  the home screen, with the same steps as `components/IOSInstallBanner.tsx`.
- **In-app browsers** (LINE, Facebook, Instagram, detected from the user
  agent): the button explains that alerts need Chrome or Safari, and offers to
  copy the link. These browsers cannot register for push.

### Following list

The existing bell panel (`components/AlertBell.tsx`) gains a "Following"
section: each followed player with the tournament name and an unfollow
control. It reads from `POST /api/push/state`. Empty when nothing is
followed.

### Strings

New `th` and `en` entries in `lib/i18n.ts` for every label and explanation
above, and the two notification titles.

### Analytics

`match_alert_followed` and `match_alert_unfollowed` (tournament id, player
id), and `match_alert_blocked` with the reason (denied, needs install, in-app
browser, unsupported), through `lib/analytics.ts`. The server counts alerts
sent and failed per day, shown on `/bmstats`.

## Privacy

`lib/privacy.ts` gains a section in both languages: when a person follows a
player, the server stores the browser's push address and the list of followed
players; it is used only to send these alerts; unfollowing everything deletes
it; a device not seen for 60 days is removed.

## Error handling

| Case | Behaviour |
|------|-----------|
| Push keys not configured | No follow button; watcher does not start |
| Browser has no push support | No follow button |
| Permission denied | Button explains how to re-enable; nothing stored |
| Device unsubscribed or app removed | Push service says gone; record deleted |
| BAT down | Watcher sends nothing until it is back |
| Schedule for today not available | That tournament is skipped this tick |
| Store file unreadable | Treated as empty; logged; next write replaces it |
| Two workers | Only the lease holder runs the watcher |
| Match reordered by the organisers | Positions are recomputed each tick; an alert already sent is not sent again |

## Testing

- `__tests__/push-alerts.test.ts` — the decision: `next` at position 1;
  `soon` at 2, 3 and 4; nothing at 5; finished, walkover and now-playing
  matches; first seen at position 1; two followed players in one match; a
  doubles match; a court-sequenced day; already-sent keys; two devices.
- `__tests__/push-store.test.ts` — create, follow, duplicate follow, unfollow,
  delete on empty, limits, stale removal, concurrent writes, unreadable file.
- `__tests__/push-sent-log.test.ts` — record, lookup, pruning.
- `__tests__/api-push-routes.test.ts` — validation (endpoint host, GUID,
  digits), feature off, each route's happy path, limits.
- `__tests__/push-watcher.test.ts` — with a fake sender and a fake schedule:
  sends once, deletes a gone device, retries a failure then gives up, skips
  during an outage, does nothing with no records, runs only as leader.
- `__tests__/push-text.test.ts` — titles and bodies in both languages, court
  omitted when absent.
- `__tests__/FollowButton.test.tsx` — each state: follow, following, denied,
  needs install, in-app browser, unsupported.
- `__tests__/AlertBell.following.test.tsx` — list and unfollow.
- Manual, at the end: a real push to an Android phone and to an iPhone with
  BATMatch on the home screen, with the app closed.

## Open points for the implementation plan

- Whether Cloudflare caches `/sw.js`; it must be served with `no-cache` so an
  update reaches devices.
- How `web-push` behaves on the server's Node version, and its memory cost.
- The exact date parameter the matches route expects for today (it takes
  BAT's own form, e.g. `25691009`).
- Where the follow button sits in the player window on a narrow screen.
