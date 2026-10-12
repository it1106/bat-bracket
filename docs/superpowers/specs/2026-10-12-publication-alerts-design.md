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

- **In scope:** the BAT tournaments the site itself shows — the list
  `/api/tournaments` serves, through the same
  `mergeForApi(manualEntries, denySet, discovered, denyNamePatterns)`. That
  keeps a discovered tournament only once its draws are out and drops anything
  `tournaments.txt` denies by id or name pattern. Announcing anything else
  would name a tournament the reader cannot open and would poll upstream every
  five minutes for every tournament BAT merely lists as upcoming. Thai and English. The same devices
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

The switch can be the panel's only content, and `AlertBell` already handles
that: `app/page.tsx` passes `hasFollowing={pushFollows.status === 'ok'}`, which
is exactly when the switch renders. No change to `AlertBell` is needed.

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
bounds the file. Pruning an entry is safe because the pass only looks at
not-`done` tournaments that are currently listed: a pruned tournament would
have to be re-listed and not finished to be seen as new again, which is a
tournament genuinely coming back.

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
tick, on the same leader lease, but **after** `runWatcherTick` and behind its
own in-flight flag — never the watcher's `busy` flag. Match alerts are
time-critical and the timer skips a tick while `busy` is set; a publication
pass can wait on a bracket probe (`FETCH_TIMEOUT_MS` is 20s, `/api/bracket`
allows 60) and must not be able to delay a call to court. The flag is
discovery's `cycleInFlight` pattern: a pass still running when the next one is
due is simply skipped.

It returns at once when `isBatDown()` — a stale read would announce nothing
truthfully.

**Detection runs even when no device has `site: true`.** The state advances;
there is simply nobody to send to. A pass that skipped detection for want of an
audience would hand the next person who switches the toggle on a month of
backlog in one burst, which is the same flood the silent seed exists to
prevent. Sending is what depends on there being devices, not detecting.

**Per tournament**, over `publicationTournaments()` filtered to not-`done`:

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
  - Counts are refreshed by probing, through `/api/bracket?tournament=<id>&event=<drawNum>`,
    which honours `ttlMsFor` and re-reads a stale entry from BAT. The probe set
    is every **un-announced** draw whose cached count is undefined **or zero** —
    not only the uncounted ones. `cachedEntrantCounts` does not check a TTL, so
    a draw whose shape was published empty on Monday answers `0` forever and
    Wednesday's entries would never be noticed. This is exactly the repeating
    batch the feature is for.
  - Up to **5** draws per tournament per pass, rotating, so a 33-draw
    tournament is covered over several passes without ever fetching 33 at
    once. The cap and its reasoning are discovery's `BRACKET_GATE_PROBE_CAP`.
    A tournament whose every draw has entries is never probed again, so the
    steady-state cost is zero.
  - **Two exceptions burst through the cap**, because the cap would otherwise
    split one publication into seven: a tournament the state has never seen is
    probed in full (so its single arrival notice carries a complete baseline
    rather than being chased by a string of bracket notices), and a tournament
    where this pass has just confirmed a draw holds entries has its remaining
    zero/unknown draws probed in the same pass (33 draws filling at once came
    from one upstream publish and belong in one notification). The cap exists
    to avoid spending fetches on tournaments whose draws are all empty; a
    burst only runs when there is something real to find.
  - **Worst case the bracket notice lags publication by about 35 minutes.**
    `/api/bracket` holds a non-static bracket for `LIVE_TTL_MS` (30 minutes),
    and an empty-shape draw is never `static` — `isBracketStatic` requires
    `rowCount === winnerCount * 2`, which a draw with no winners cannot meet.
    So a cached zero expires within half an hour and the next pass sees the
    entries.
- **Schedule** → `/api/matches?tournament=<id>`: days with `dateIso > today`
  and `hasMatches === true` whose date is not in `days[]` make one `schedule`
  publication naming them. The same filter `recordScheduleSnapshot` uses, so
  the bell and the notification never disagree about what counts as a new
  playing day.
- A fetch that fails or answers not-ok **skips that tournament and writes
  nothing for it**. A network failure is not evidence that nothing is
  published.

**Guards.** If the tournament list is empty while the state holds entries, the
whole pass is skipped and logged — discovery's suspicious-snapshot rule, which
exists because an upstream hiccup must not be read as "everything is gone".

### 5. Sending

One notification per tournament per kind per pass, to every record with
`site: true`, in that record's own `lang`, with a **24-hour TTL at normal
urgency**. `webPushSender` hard-codes `TTL: 600` and `urgency: 'high'`, which
is right for a call to court and wrong here: delivery is at-most-once, so a
phone switched off when a 2am draw lands would otherwise never be told. The
sender takes those two as options; match alerts keep today's values. Reuses the existing machinery: the
`Sender` from `webPushSender`, `removeRecord` on `gone`, `recordPush` for the
stats tiles, and a `noteSend` row for the status table — `draw` = the
tournament name, `round` = empty, `match` = the notification body,
`via` = `site news`.

Tags: `pub:t:<ID>`, `pub:b:<ID>:<minuteKey>`, `pub:s:<ID>:<minuteKey>`. The
prefix keeps a publication from replacing a match alert on the device, since
`matchTag` is `<drawNum>|<ids>`; the minute key lets a second batch of draws
show as its own notification rather than overwriting the first.

**State is written before the sends go out**, and a failure is not retried.
This is deliberate: the state is global rather than per-device, so a retry
would re-notify every device that already received it — and writing afterwards
would mean a pm2 reload mid-send re-announces to everyone already reached.
At-most-once is the chosen semantics, so the record of "announced" is made
first. A failed send is logged and counted in the stats like any other.
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
| Tournament list empty, state non-empty | Pass skipped, warned |
| `tournaments.txt` unreadable | Empty list, so the pass is skipped; the next one tries again |
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
- `isBatDown()` and an empty tournament list each skip the pass without
  writing.
- With no `site` devices the pass still detects and records, and sends nothing;
  a device switching on afterwards receives no backlog.
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
| `lib/push/tournaments.ts` | `publicationTournaments()` — the BAT tournaments the site itself shows, with their names |
| `lib/push/sender.ts` | optional TTL and urgency |
| `lib/push/published-state.ts` | new — the disk-backed state |
| `lib/push/publications.ts` | new — `duePublications`, `runPublicationPass` |
| `lib/push/text.ts` | the three payload builders |
| `lib/push/watcher.ts` | every-fifth-tick call into the pass, own in-flight flag |
| `lib/push/client.ts` | `setSite` |
| `lib/push/PushFollowsContext.tsx` | `siteNews`, `setSiteNews` |
| `app/api/push/site/route.ts` | new |
| `app/api/push/state/route.ts` | answers with `site` |
| `components/SiteNewsSwitch.tsx` | new — the switch |
| `lib/i18n.ts` | labels and the three titles |
| `components/BmStats.tsx` | local `stage` type widened |
