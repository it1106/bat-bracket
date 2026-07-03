# Adding a BWF tournament

Runbook for adding a BWF event so it appears in the tournament dropdown. The
happy path is one line; the rest of this doc exists because Cloudflare makes the
*auto-resolve* unreliable, and the workaround isn't obvious.

## TL;DR

```bash
# 1. add the event to the manual list (local checkout)
#    public/tournaments.txt:
#       @bwf https://bwfbadminton.com/tournament/<id>/<slug>/        # upcoming/active
#       @bwf https://bwfbadminton.com/tournament/<id>/<slug>/ [done] # finished
#    Use the canonical tournament URL — drop any trailing /results/, /draws/, etc.

# 2. commit + deploy (see DEPLOY.md)
git push && ssh root@ezebat.lan "set -e; cd ~/app && git pull --ff-only && npm run build && pm2 reload bat-bracket"

# 3. seed the resolver cache (the part that otherwise hangs on Cloudflare)
ssh root@ezebat.lan "cd ~/app && node scripts/seed-bwf-tournament.cjs 'https://bwfbadminton.com/tournament/<id>/<slug>/' && pm2 reload bat-bracket"

# 4. verify
ssh root@ezebat.lan "curl -s http://localhost:3000/api/tournaments | grep -i '<part-of-name>'"
```

## How BWF events normally resolve

A `@bwf <url>` line in `public/tournaments.txt` carries no metadata. On each
`/api/tournaments` request the parser (`lib/tournaments-txt.ts`) looks the URL up
in the sidecar cache `public/bwf-cache.json`; if it's missing it fires
`resolveBwfUrl()` (`lib/providers/bwf/url-resolver-runtime.ts`) in the
background. That scrapes the page via headless Chromium, extracts
`mainTmtId` / `tournamentCode` / `tournamentSlug` / title / `token` plus the
dates, and writes the sidecar entry. Once cached, the event appears.

The sidecar is **keyed by the exact URL string** in `tournaments.txt`. Keep them
byte-identical (same trailing slash, no `/results/`).

## Why it often doesn't resolve on its own

bwfbadminton.com is behind Cloudflare. The app keeps a **long-lived** Chromium
context (15-min lifetime) and reuses it. That context frequently gets
**403-challenged on tournament pages**, and `fetchPageHtml()` has no 403
re-prime/retry (unlike `request()`), so it returns the challenge page →
`extractMetaFromPageHtml` returns null → log spam:

```
[bwf-resolve] could not extract meta from https://bwfbadminton.com/tournament/<id>/...
```

A brand-new event can sit unresolved for a long time this way. Symptoms:
the event is in `tournaments.txt` but never shows in the dropdown, and the URL
is **not** a key in `public/bwf-cache.json`.

Key fact: a **fresh** headless-Chromium launch gets HTTP 200 with all fields
every time. The problem is the *reused, Cloudflare-tainted* context, not the
page or the URL. That's what the seed script exploits.

## The fix: seed the cache (`scripts/seed-bwf-tournament.cjs`)

Run it **on the prod server** (`ezebat.lan`) — that host has good Cloudflare
standing. A laptop/dev IP is challenged harder and may fail; the server gets 200.

```bash
ssh root@ezebat.lan
cd ~/app
node scripts/seed-bwf-tournament.cjs 'https://bwfbadminton.com/tournament/<id>/<slug>/'
pm2 reload bat-bracket   # REQUIRED: the running process caches the sidecar in
                         # memory and won't see a direct file write until restart
```

The script launches a throwaway browser, primes via `/calendar/`, fetches the
page, extracts the same fields the resolver would, backs up
`public/bwf-cache.json` (to `*.bak.<ts>`), writes the genuine entry, and prints
it. It's byte-identical to what the resolver produces, so it's a safe shortcut,
not a hack.

Pass the **same URL** you put in `tournaments.txt` (sidecar is keyed by exact
URL).

## Verify

```bash
# on the server
curl -s http://localhost:3000/api/tournaments | grep -i '<part-of-name>'
```

You want an entry with `"provider":"bwf"`, the real 36-char `tournamentCode` as
`id`, the name, and `startDateIso`. No `done` field for an upcoming event (it
auto-flips once all match dates pass).

## Heads-up: memory regime flips when a BWF event is active

The Chromium memory strategy is gated on "is there an **active (not-done)** BWF
tournament?" (`instrumentation.ts`):

- **No active BWF** → the 5-min recycle heartbeat **closes Chromium entirely**
  (bwfbadminton.com ad/analytics JS leaks ~1 GB / 30 min if left open).
- **Active BWF** → Chromium stays **resident** and re-primes every 15 min.

So adding/seeding a live BWF event **turns the resident-Chromium leak regime back
on**. This is expected. It's bounded by the 15-min re-prime + 5-min heartbeat +
SIGKILL teardown; PM2's `max_memory_restart` (2000M) is only a backstop and does
**not** count Chromium child-process memory. If memory climbs and stays high,
check `ps -eo pid,rss,etime,comm | grep chrom` and confirm the recycle heartbeat
is firing (`grep bwf-recycle`/`bwf-cf` in the PM2 logs). The 22-Jun-2026 OOM was
a leader-gating bug in that heartbeat (since fixed — the tick is per-worker).

## Known structural fix (not yet done — deliberate)

Chromium exists **only** for the BWF Cloudflare bypass (`cf-context.ts` is the
sole `playwright-core` consumer). Cloudflare here uses **passive** TLS/JA3 +
HTTP-2 fingerprinting, which a TLS-impersonation HTTP client (`curl-impersonate`
/ `curl_cffi`) defeats with ~zero CPU and no browser — validated: it returned
200 + token from the calendar page and 200 JSON from the API host that
hard-403s plain `fetch`/`curl`.

Migrating the BWF transport to curl-impersonate would remove Chromium entirely
(killing the CPU **and** memory problems) and make this whole seed dance
unnecessary. Risks and why it's deferred:

- **No JS execution** — if Cloudflare escalates to an *active* challenge
  (JS/Turnstile), the BWF path breaks completely with no warning. Keep a
  fallback (Bright Data Web Unlocker, already configured — not standby Chromium,
  which rots).
- **Fingerprint drift** — pinned impersonation profiles need occasional bumps.
- **Native-binary deployment friction** (no pip/venv on the prod box).
- Validation so far is only ~a handful of requests; do a server-side canary
  before committing.

## Fixed 03-Jul-2026: vue-tournament-* endpoints moved POST → GET

BWF migrated the `vue-tournament-detail` / `vue-tournament-draws` /
`vue-tournament-draw-data` endpoints to **GET-only**; a POST now returns
**405 Method Not Allowed**. Because `bwfProvider.getDraws`/`getBracket`/
`getMatchesFull` catch and `return []`, every BWF bracket silently went blank
(the tournament still resolved and appeared in the list — only the draw/bracket
was empty). Symptom in the logs: `[bwf] getDraws failed: Error: BWF API 405 for
/api/vue-tournament-draws`.

Fix: `lib/providers/bwf/api-client.ts` now issues `GET` with the params in the
query string. The response envelope (`{ results: … }`) is unchanged, so the
parsers were untouched. Regression-guarded by `__tests__/bwf-api-client.test.ts`
(asserts GET + query string so a revert to POST fails CI). Verified on prod:
POST → 405, GET → 200 with real draw data.
