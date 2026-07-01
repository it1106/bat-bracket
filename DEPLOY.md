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
