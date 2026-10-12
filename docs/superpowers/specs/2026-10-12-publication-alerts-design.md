# Publication Alerts (new tournament, draws, schedule)

**Date:** 2026-10-12

## Summary

A device can switch on one site-wide notification: tell me when something new
is published. Three things count as published — a tournament appearing on the
site for the first time, a tournament's draws arriving with players in them,
and a tournament's playing days appearing on the schedule.

These are additional to today's match alerts. A person who follows a player or
a club keeps getting "about N matches away", "Now Playing" and the result; the
new switch is independent of any follow, and a device may have it on while
following nobody.

It is for the parent, coach or player who watches for the next tournament to
open and for its draws to come out, and who today has to keep opening the site
to find out. The site already shows these three notices in the bell, but only
to someone with the app open: `lib/alerts.ts` computes them in the browser from
localStorage snapshots, so a draw published while the phone is in a pocket is
never announced.

Concrete example: BAT publishes THE MALL BADMINTON CHAMPIONSHIP 2026 on a
Tuesday afternoon. The phone shows "New tournament · THE MALL BADMINTON
CHAMPIONSHIP 2026". Four days later the draws land and it shows "Draws are out
· THE MALL BADMINTON CHAMPIONSHIP 2026 · BS U15, GS U15 +31". Tapping either
opens BATMatch on that tournament.

## Decisions already made

- **"New event" means a new tournament**, one never listed on the site before.
  Not a new draw or category inside a tournament, and not "a followed player
  has entered somewhere new" (that needs cross-tournament player identity,
  which `playerId` does not provide).
- **One switch for all three kinds**, site-wide. Not three switches, and not
  limited to tournaments the device follows.
- **No quiet hours.** A publication goes out when it is found, at any hour.
  (Discovery itself is skipped 00:00–08:00 Bangkok, so a tournament published
  at 2am is announced after 08:00 regardless. Draws and schedules are not
  affected by that window.)
- **Per batch, repeating.** More draws or more schedule days arriving later
  fire again. This is the common case: some draws on Monday, the rest on
  Wednesday.
- **Detection lives in the push watcher** (approach A), not in the producers
  (discovery, cache warmers) and not in a separate scheduled process.

## Scope

- **In scope:** BAT tournaments the site lists (`alertTournaments()`), which is
  the registry plus the discovery store. Thai and English. The same devices
  match alerts already reach.
- **Out of scope:** BWF tournaments. Ranking publications (the bell's third
  kind — BAT/BWF ranking editions already have their own poller and could be
  added later the same way). Per-draw or per-day granularity. Quiet hours.
  Choosing which kinds to receive separately. Following a tournament
  individually. Accounts or syncing the switch between devices.

## Design

### 1. Opt-in on the device record

`PushSubscriptionRecord` gains `site?: boolean` — this device wants
publications. Absent means off.

New route `POST /api/push/site` with `{ subscription, lang, on }`, answering
`{ follows, site }`. It validates the subscription exactly as
`/api/push/follow` does (`parseSubscription`), applies `allowNewDevice` rate
limiting when the server has not seen the endpoint before, and respects
`MAX_DEVICES`. There is no tournament to check, so `alertTournaments()` is not
consulted. `POST /api/push/state` starts returning `{ follows, site }`.

New store function `setSite(sub, lang, on, now, os)`, written like `addFollow`
through the same `change()` chain.

**Three current behaviours change**, because today a device exists only to hold
follows:

1. `removeFollow` deletes the record when the last follow goes. It must keep a
   record whose `site` is true.
2. `removeFollowsIn` (the finished-tournament sweep) does the same, and gets
   the same exception.
3. `setSite(..., false)` deletes the record when there are no follows left —
   the mirror of unfollowing the last player.

The 60-day stale prune (`pruneStale`) is unchanged: a device that stops asking
still ages out, switch or no switch.

Client side: `setSite(subscription, lang, on)` joins `PushClient`, and
`PushFollowsContext` exposes `siteNews: boolean` and
`setSiteNews(on): Promise<FollowOutcome>`, reusing `follow`'s
permission-then-subscribe sequence so turning the switch on is what asks for
notification permission on a device that has never granted it. The provider's
load effect reads `site` out of the `/api/push/state` answer.

### 2. UI

One switch in the bell panel, directly above the Following list, labelled
"New tournaments, draws & schedules" (Thai: "ทัวร์นาเมนต์ สาย และตารางใหม่").
Rendered only where `push.status === 'ok'`, the guard `FollowingList` already
uses, so a browser that cannot do push never shows it. A device whose
permission is `denied` sees the switch disabled with the same explanation the
follow buttons give. `track('site_news_toggled', { on })`.

Because the switch can be the panel's only content, `AlertBell`'s
`hasFollowing` gate must open the panel for it too.

### 3. Detection state — `.cache/push/published.json`

```json
{
  "version": 1,
  "seeded": true,
  "tournaments": {
    "<GUID>": {
      "name": "THE MALL BADMINTON CHAMPIONSHIP 2026",
      "firstSeenAt": "2026-10-12T04:00:00.000Z",
      "announced": true,
      "draws": ["1", "4"],
      "days": ["2026-10-20", "2026-10-21"]
    }
  }
}
```

`draws` holds the draw numbers already announced as published-with-entries;
`days` the schedule dates already announced.

Built with `sent-log.ts`'s mechanics and for its reasons: state on
`globalThis`, the file's mtime remembered, a write merging whatever another
worker put there first. The leader lease moves between workers on reload, and
two workers each holding a private copy would announce the same draws twice.

It is **append-only**: a draw number or a date, once in, stays in. BAT
re-publishing a draw, or a day dropping off and returning, therefore cannot
fire a second time. A tournament's whole entry is dropped once it is no longer
in `alertTournaments()` and its `firstSeenAt` is more than 30 days old, which
bounds the file.

**First run seeds silently.** With no file, the pass writes the complete
current snapshot — every listed tournament, its entered draws, its future
playing days — with `seeded: true`, and sends nothing. Without this, the first
deploy announces every bracket and schedule already published. This is the
same principle as `resultSeen` in the watcher and `isBootstrapped()` in
`lib/alerts.ts`.

### 4. The pass — `lib/push/publications.ts`

Two exports, split the way `watcher.ts` splits `runWatcherTick` from
`startPushWatcher`:

- `duePublications(input): Publication[]` — pure. Takes the listed
  tournaments, the stored state, and per-tournament draws and days already
  fetched; returns what should go out and the state additions each implies.
- `runPublicationPass(deps)` — fetches, calls the pure function, sends,
  records.

```ts
export type PublicationKind = 'tournament' | 'bracket' | 'schedule'

export interface Publication {
  kind: PublicationKind
  tournamentId: string
  tournamentName: string
  /** Draw names for 'bracket', ISO dates for 'schedule', empty for 'tournament'. */
  items: string[]
}
```

A separate type, not `DueAlert` — that one requires a `match: MatchEntry`.

**Cadence.** Called from the watcher's existing one-minute timer, every fifth
tick, so the one leader lease governs match alerts and publications together
and there is no second timer to reason about. It returns at once when
`isBatDown()` (a stale read would announce nothing truthfully) or when no
record has `site: true` (nobody to tell, so nothing is fetched and **nothing is
recorded** — the state must not silently advance past publications no device
has been told about; an empty device list skips the pass entirely, seeding
included).

**Per tournament**, over `alertTournaments()` filtered to not-`done`:

- **Id not in state** → a `tournament` publication, and its entry is written
  with `announced: true` plus whatever draws and days it already has, recorded
  *silently*. A tournament that arrives with draws already out gets one notice,
  not three.
- **Id in state** → `/api/draws?id=<id>` through the app's own route, which
  shares the cache with visitors and never asks BAT directly (the reason
  `makeFetchDay` exists). Draws whose `entrantCount > 0` and whose `drawNum` is
  not in `draws[]` make one `bracket` publication naming them.
  - `entrantCount` is **cache-only**: undefined means not counted, never zero
    (`lib/bracket-state.ts`). An undefined count never fires and never records.
  - Counts become known by probing: up to **5** draws per tournament per pass
    that have no count yet are fetched through `/api/bracket`, which caches
    them. The cap and its reasoning are discovery's `BRACKET_GATE_PROBE_CAP` —
    a tournament with 33 empty draws must not burn the fetch budget. Only
    tournaments with uncounted draws are probed, so this costs nothing once a
    tournament is fully counted.
- **Schedule** → `/api/matches?tournament=<id>`: days with `dateIso > today`
  and `hasMatches === true` whose date is not in `days[]` make one `schedule`
  publication naming them. The same filter `recordScheduleSnapshot` uses, so
  the bell and the notification never disagree about what counts as a new
  playing day.
- A fetch that fails or answers not-ok **skips that tournament and writes
  nothing for it**. A network failure is not evidence that nothing is
  published.

**Guards.** If `alertTournaments()` is empty while the state holds entries, the
whole pass is skipped and logged — discovery's suspicious-snapshot rule, which
exists because an upstream hiccup must not be read as "everything is gone".

### 5. Sending

One notification per tournament per kind per pass, to every record with
`site: true`, in that record's own `lang`. Reuses the existing machinery: the
`Sender` from `webPushSender`, `removeRecord` on `gone`, `recordPush` for the
stats tiles, and a `noteSend` row for the status table — `draw` = the
tournament name, `round` = empty, `match` = the notification body,
`via` = `site news`.

Tags: `pub:t:<ID>`, `pub:b:<ID>:<minuteKey>`, `pub:s:<ID>:<minuteKey>`. The
prefix keeps a publication from replacing a match alert on the device, since
`matchTag` is `<drawNum>|<ids>`; the minute key lets a second batch of draws
show as its own notification rather than overwriting the first.

**State is written once, after the pass has tried every device**, and a
per-device failure is not retried. This is deliberate: the state is global
rather than per-device, so retrying would re-notify every device that already
received it. A failed send is logged and counted in the stats like any other.
`sent-log.ts` is not used for this — it prunes keys after two days, and a
publication must stay announced for good.

### 6. Text — `lib/push/text.ts`

| Kind | Title (EN) | Title (TH) |
|---|---|---|
| tournament | New tournament | ทัวร์นาเมนต์ใหม่ |
| bracket | Draws are out | สายการแข่งขันออกแล้ว |
| schedule | Schedule published | ตารางแข่งออกแล้ว |

Body: the tournament name, then the items — draw names, or dates formatted as
the bell formats them — joined with `· `, capped at four with `+N more` /
`+อีก N` beyond that, following `digestPayload`. `url` is
`/?tournament=<ID>`, the deep link `app/page.tsx` already reads.

### 7. Types and the status page

`Stage` in `lib/push/types.ts` widens to
`'soon' | 'playing' | 'result' | PublicationKind`, since `RecentSend.stage` is
typed from it. `components/BmStats.tsx` prints `send.stage` verbatim, so only
its stale local literal type (`'soon' | 'next' | 'result'`) needs widening —
no rendering change.

### 8. Error handling

| Failure | Behaviour |
|---|---|
| BAT down (`batDownSince()`) | Pass skipped, nothing recorded |
| `alertTournaments()` empty, state non-empty | Pass skipped, warned |
| `/api/draws` or `/api/matches` not ok | That tournament skipped, nothing recorded for it |
| `entrantCount` undefined | Not a publication; probed later, never recorded |
| Bracket probe fails | Count stays unknown, retried next pass |
| `published.json` unreadable | Treated as absent → seeds silently (never a flood) |
| Push send fails | Logged and counted; not retried (§5) |
| Push send `gone` | Record removed, as in the match watcher |

### 9. Testing

Unit tests over the pure function and the store, mirroring
`__tests__/push-watcher.test.ts` and `push-store.test.ts`:

- First run with no state file announces nothing and writes the full snapshot.
- A tournament absent from state fires one `tournament` publication, and its
  existing draws and days are recorded without firing.
- Draws with `entrantCount > 0` fire one `bracket` publication naming them;
  a second batch days later fires again; the first batch does not.
- `entrantCount` undefined and `entrantCount === 0` never fire.
- New future days with `hasMatches === true` fire one `schedule` publication;
  today and past days do not.
- State is append-only: a draw or date already announced never fires again.
- `isBatDown()`, no `site` devices, and an empty tournament list each skip the
  pass without writing.
- A failed draws or matches fetch leaves that tournament's state untouched.
- Store: `site` survives the last follow being removed, including through
  `removeFollowsIn`; `setSite(false)` with no follows deletes the record;
  `setSite` respects `MAX_DEVICES`.
- Route tests in `__tests__/api-push-routes.test.ts`: validation, rate limit,
  404 when push is not configured, `state` returning `site`.
- Text tests for both languages and the `+N more` cap.
- `PushFollowsContext` test for `setSiteNews` and the permission path.

Implementation follows TDD: each behaviour's test is written and seen to fail
before the code that satisfies it.

### 10. Files touched

| File | Change |
|---|---|
| `lib/push/types.ts` | `site` on the record, `Stage` widened, `Publication` types |
| `lib/push/store.ts` | `setSite`, record kept while `site` is on |
| `lib/push/published-state.ts` | new — the disk-backed state |
| `lib/push/publications.ts` | new — `duePublications`, `runPublicationPass` |
| `lib/push/text.ts` | the three payload builders |
| `lib/push/watcher.ts` | every-fifth-tick call into the pass |
| `lib/push/client.ts` | `setSite` |
| `lib/push/PushFollowsContext.tsx` | `siteNews`, `setSiteNews` |
| `app/api/push/site/route.ts` | new |
| `app/api/push/state/route.ts` | answers with `site` |
| `components/SiteNewsSwitch.tsx` | new — the switch |
| `components/AlertBell.tsx` | panel opens for the switch alone |
| `lib/i18n.ts` | labels and the three titles |
| `components/BmStats.tsx` | local `stage` type widened |
