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
npm run build
pm2 reload bat-bracket
pm2 list                        # confirm worker online
```

## One-liner from local machine

```bash
git push && ssh root@ezebat.lan "set -e; cd ~/app && git pull --ff-only && npm run build && pm2 reload bat-bracket && pm2 list | grep bat-bracket"
```

## ⚠️ Deploy hazard: Cloudflare caching build-time 404s

`npm run build` rewrites `.next/static/*` **in place**. Next asset filenames are
content-hashed, so a normal deploy changes some chunk/CSS hashes. For the few
seconds mid-build when an asset's file is momentarily absent, any request for it
returns 404 — and **Cloudflare caches that 404** (default negative TTL is hours).
The origin recovers instantly, but the edge keeps serving the stale 404, so:

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

### Prevention (do these once)

1. **Stop Cloudflare caching 4xx.** Add a Cache Rule for `/_next/static/*` that
   sets *Edge Cache TTL by status code* → `404, 410 = No cache` (or bypass cache
   on 4xx). This alone prevents the poisoning permanently.
2. **Purge static after each build** as a post-deploy step (needs a scoped API
   token with Zone → *Cache Purge*), or build into a fresh dir and swap so assets
   are never briefly missing. Until then, expect a possible blip on deploy and
   hard-refresh (Cmd+Shift+R) to confirm.

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

## After a restart

Pre-warm runs for ~90 s, fetching every bracket of every tournament listed in
`public/tournaments.txt`. The first user request during that window may be slow.
Watch for the last `pre-warmed:` line to know it's done:

```bash
tail -f /root/.pm2/logs/bat-bracket-out-0.log | grep 'pre-warmed'
```
