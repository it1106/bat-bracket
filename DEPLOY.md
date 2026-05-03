# Deploying to ezebat.lan

The app runs on `ezebat.lan` as PM2 process `bat-bracket` (2-worker cluster, port 3000).
Code lives at `/root/app`, pulled from `https://github.com/it1106/bat-bracket`.

## Standard deploy

```bash
# from your local checkout
git push

# on ezebat.lan
ssh root@ezebat.lan
cd ~/app
git pull --ff-only
npm run build
pm2 restart bat-bracket
pm2 list                        # confirm both workers online
```

## One-liner from local machine

```bash
git push && ssh root@ezebat.lan "set -e; cd ~/app && git pull --ff-only && npm run build && pm2 restart bat-bracket && pm2 list | grep bat-bracket"
```

## Switching branches on the server

```bash
ssh root@ezebat.lan
cd ~/app
git fetch --all
git checkout <branch>
git pull --ff-only
npm run build
pm2 restart bat-bracket
```

## Logs

```bash
ssh root@ezebat.lan
tail -f /root/.pm2/logs/bat-bracket-out-0.log     # stdout (worker 0)
tail -f /root/.pm2/logs/bat-bracket-error-0.log   # stderr (worker 0)
# worker 1: bat-bracket-{out,error}-1.log
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
