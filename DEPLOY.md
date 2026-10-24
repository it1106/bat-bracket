# Deploying to ezebat.lan

The app runs on `ezebat.lan` as PM2 process `bat-bracket` (1-worker cluster, port 3000).
Code lives at `/root/app`, pulled from `https://github.com/it1106/bat-bracket`.

## URLs (don't confuse these)

- **Public site (what users hit): https://batmatch.app** — Cloudflare-proxied.
  Cloudflare reaches the origin through a **Cloudflare Tunnel connector that
  runs off this box** (router/another LAN device), so tunnel hiccups (e.g. after
  a reboot) show up as slow/erratic public latency even when the app is fine.
- **`ezebat.lan`** — the LAN host for SSH/admin and the app origin itself. Not
  the public URL. mDNS name, so it can fail to resolve transiently. Direct:
  `http://172.16.88.198:3000/` (fast LAN bypass of Cloudflare).

Triage: if `batmatch.app` is slow but `http://172.16.88.198:3000/` is fast, the
app is healthy and the problem is the Cloudflare tunnel path — restart the
`cloudflared` connector (off-box), don't touch the app.

## Standard deploy

`pm2 reload` is zero-downtime: it spawns a new worker, waits for it to listen on
:3000, then kills the old one. Use this instead of `pm2 restart`.

```bash
# from your local checkout
git push

# on ezebat.lan
ssh root@ezebat.lan
cd ~/app
git pull --ff-only
npm install --no-audit --no-fund   # only needed when package.json changed; harmless otherwise
npm run build
pm2 reload bat-bracket
pm2 list                        # confirm worker online
```

## One-liner from local machine

```bash
git push && ssh root@ezebat.lan "set -e; cd ~/app && git pull --ff-only && npm install --no-audit --no-fund && npm run build && pm2 reload bat-bracket && pm2 list | grep bat-bracket"
```

`npm install` is part of the deploy because a build against missing dependencies
fails (or, worse, builds and then crashes at runtime). It takes a few seconds
when nothing changed.

## ⚠️ Deploy hazard: Cloudflare caching build-time 404s

`npm run build` rewrites `.next/static/*` **in place**. Next asset filenames are
content-hashed, so a normal deploy changes some chunk/CSS hashes. For the few
seconds mid-build when an asset's file is momentarily absent, any request for it
returns 404 — and **Cloudflare used to cache that 404 for hours**. The origin
recovers instantly, but the edge kept serving the stale 404, so:

- a missing JS chunk → `ChunkLoadError` → blank/broken page (looks like an outage);
- a missing CSS file → unstyled page.

This bit us on 2026-07-12: `chunks/328-*.js` and a `css/*.css` got stuck as
cached 404s at the edge while the origin served them fine. Symptoms and triage:

```bash
# Origin is healthy if the LAN bypass serves the asset 200:
curl -si http://172.16.88.198:3000/_next/static/chunks/<hash>.js | head -1
# Edge is poisoned if the SAME url is 404 but a cache-busting query is 200:
curl -si "https://batmatch.app/_next/static/chunks/<hash>.js"       | head -1  # 404 cf HIT
curl -si "https://batmatch.app/_next/static/chunks/<hash>.js?cb=1"  | head -1  # 200 cf MISS
```

If origin=200 but edge=404, it's edge cache poisoning — **not the app**.

### Fix when it happens

Purge the Cloudflare cache (dashboard → `batmatch.app` → Caching → **Purge
Everything**, or Custom Purge the exact asset URLs for both apex and `www`).
There is no CF API token on the box, so this is a manual dashboard action.

### Prevention

1. **Stop Cloudflare caching 4xx — DONE (2026-10-12).** A Cache Rule on
   `batmatch.app`, matching `starts_with(http.request.uri.path, "/_next/static/")`,
   sets Edge TTL *Status Code TTL* → `404` and `410` = no cache. Verified the
   day it went in: a missing asset answers `MISS` then `EXPIRED` on every
   repeat and never `HIT` (the edge revalidates with the origin every time),
   while a real asset still answers `HIT`. Re-test any time with:

   ```bash
   U="https://batmatch.app/_next/static/chunks/zzz-$(date +%s).js"
   for i in 1 2 3; do curl -sI "$U" | grep -iE '^HTTP|^cf-cache-status'; done
   # want: never HIT.  And a real asset must still be HIT.
   ```

2. **Still open: browsers are told to keep the 404 for 4 hours.** The edge
   stamps `cache-control: max-age=14400` on 404s *under `/_next/static/`*,
   overriding the origin, which sends `no-cache, no-store, must-revalidate`.
   A 404 on any other path passes the origin header through untouched and is
   never cached (`cf-cache-status: DYNAMIC`), so this comes from a rule scoped
   to that path — look through Caching → Cache Rules (and legacy Page Rules)
   for one setting a 4-hour **Browser TTL** on `/_next/static/*`. Consequence:
   a visitor who loads a page mid-deploy and 404s on a chunk stays broken
   locally for up to 4 hours even though the edge and origin are fine; they
   need a hard-refresh (Cmd+Shift+R). Fix is one field — set **Browser TTL**
   to *Respect origin TTL* on that path. That is strictly better for the 200s
   too: the origin sends `max-age=31536000, immutable`, so real assets would
   be cached for a year instead of four hours.

3. **Purge static after each build** as a post-deploy step. Needs a scoped API
   token (Zone → *Cache Purge*) on the box; there is none today.

   **Do not** "build into a fresh dir and swap" — it reads like a fix and is
   not one. Asset filenames are content-hashed, so the old build's hashes do
   not exist in the new directory at all. An atomic swap removes the
   build-time window and opens an identical one at swap time: during
   `pm2 reload` the still-running old worker serves pages referencing hashes
   that are now gone. It narrows the window; it does not close it. Item 1 is
   what actually closes the failure mode.

### `www` vs apex

The public/canonical host is the **apex** `batmatch.app`. `www.batmatch.app` is
redirected to it via a Cloudflare Redirect Rule (`http.host eq
"www.batmatch.app"` → `301` to `concat("https://batmatch.app",
http.request.uri.path)`, preserve query). `www` sits behind an extra off-box
caching proxy on the tunnel device that re-serves poisoned 404s even after a CF
purge, so keep traffic canonicalized to the apex. If `www` ever needs its own
static serving again, that proxy's cache must be cleared on the tunnel device.

## Switching branches on the server

```bash
ssh root@ezebat.lan
cd ~/app
git fetch --all
git checkout <branch>
git pull --ff-only
npm install --no-audit --no-fund
npm run build
pm2 reload bat-bracket
```

## Logs

PM2 names each worker's log file `bat-bracket-{out,error}-N.log` where N is
the PM2 instance index. The active worker is whichever file has a current
mtime — don't assume `-0`; after some restarts/upgrades it has been `-1`.
Find it first:

```bash
ssh root@ezebat.lan
ls -t /root/.pm2/logs/bat-bracket-out-*.log | grep -v __ | head -1   # newest stdout
ls -t /root/.pm2/logs/bat-bracket-error-*.log | grep -v __ | head -1 # newest stderr
```

Then tail it:

```bash
tail -f $(ls -t /root/.pm2/logs/bat-bracket-out-*.log | grep -v __ | head -1)
```

Count BAT upstream calls (since instrumentation in `lib/bat-fetch.ts`):

```bash
grep '\[bat-fetch\]' /root/.pm2/logs/bat-bracket-out-*.log \
  | grep -oP 'kind=\S+' | sort | uniq -c | sort -rn
```

### Access log (who asked for what)

Every request except build files is written to `/root/app/.cache/access-log/<day>.log`,
one JSON line each: time, visitor address and country (from Cloudflare), method,
status (`0` = the visitor left before an answer), milliseconds, URL, user agent
and referer. Files are kept 14 days (`lib/access-log.ts`). `cc` is `direct` for
a request that did not come through Cloudflare.

```bash
cd /root/app/.cache/access-log
grep '"ip":"203.0.113.7"' 2026-10-05.log                       # everything one address did
grep -o '"ip":"[^"]*"' 2026-10-05.log | sort | uniq -c | sort -rn | head   # busiest addresses
grep '/api/bat/player-ages' 2026-10-05.log | grep -o '"ip":"[^"]*"' | sort | uniq -c | sort -rn | head
```

## After a restart

Pre-warm runs for ~90 s, fetching every bracket of every tournament listed in
`public/tournaments.txt`. The first user request during that window may be slow.
Watch for the last `pre-warmed:` line to know it's done:

```bash
tail -f /root/.pm2/logs/bat-bracket-out-0.log | grep 'pre-warmed'
```

## Match alerts (web push)

Off until three settings are in `/root/app/.env.production`:

```bash
# once, on any machine with the repo:
npx web-push generate-vapid-keys
```

```
VAPID_PUBLIC_KEY=<the public key printed above>
VAPID_PRIVATE_KEY=<the private key printed above>
VAPID_SUBJECT=mailto:<an address you read>
```

Then `pm2 reload bat-bracket`. The log line `[push] watcher started` confirms it; without the settings there is no such line and no follow button on the site.

- **Do not change the key pair** once people have followed someone: every existing subscription was made against the public key and would stop receiving alerts.
- State lives in `.cache/push/` (`subscriptions.json`, `sent.json`). Deleting `subscriptions.json` unfollows everyone.
- `/sw.js` must reach browsers uncached. `next.config.js` sends it with `no-store`; if a Cloudflare cache rule ever covers `*.js`, exclude `/sw.js`. Check with `curl -sI https://batmatch.app/sw.js | grep -i 'cache-control\|cf-cache-status'` (expect `no-store`, and `BYPASS` or `DYNAMIC`).
- Counts for the day are on `/bmstats` under "Match alerts". A tick that sent or failed anything logs `[push] tick sent=… failed=… gone=…`.
- The watcher asks the app's own `/api/matches` once a minute for each tournament it is watching, so it shares the schedule cache and adds at most one BAT request a minute per such tournament when nobody is viewing it. Which tournaments those are depends on what people follow:
  - a follow made in one tournament is watched only there;
  - a follow that names no tournament — "Every tournament" on the bell, matched on the player's name key — is looked for in *every* tournament that could still be playing: listed or discovered, not marked `[done]`, and without the pinned full schedule the app writes once all its days are past. So one such follow, by anyone, is enough to put every live tournament on the once-a-minute list.
  A tournament with no day today costs one cached read. A live one is read once a minute while the warmer only refreshes every four, so a live tournament nobody is viewing can cost about one BAT schedule fetch a minute while such a follow exists. `/bmstats` shows each follow's reach under "Match alerts": `all tournaments` or the tournament's name, and `results only` where the follow asked for the score alone.
