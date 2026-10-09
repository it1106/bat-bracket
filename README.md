# BATMatch

An unofficial scoreboard and bracket viewer for Badminton Association of
Thailand (BAT) tournaments, published on
[bat.tournamentsoftware.com](https://bat.tournamentsoftware.com), with BWF
rankings and player data alongside. Live at **https://batmatch.app**.

Bilingual (English / ไทย), dark mode, and installable as a PWA on iOS and
Android.

> Unofficial: all data is scraped from public pages and may lag or differ from
> the source. The app says so in-product — *"Check BAT official website for
> accuracy"* — and carries a full [disclaimer](https://batmatch.app/disclaimer) page.

## Features

- **Brackets** — the draw rendered from BAT's own markup, with player tracking
  and highlighting, group/knockout standings, and jump-to-next-unplayed.
- **Match schedule** — per-draw and per-team, sortable by court or match
  number, with playing order and live scores while a match is on.
- **Player profiles** — match history, head-to-head, frequent opponents,
  win/loss splits, and year-of-birth/age where published.
- **Rankings** — BAT and BWF ranking boards, week-over-week movement, and a
  per-player ranking detail view showing which tournaments count, which are
  expiring, and when points drop out. A projected next-week ranking runs as a
  pilot on the U15 boards.
- **Leaderboards** — career titles, wins, win percentage and court time.
- **Tournament stats** — entry and country breakdowns, a country head-to-head
  matrix (also as a standalone full-page view), and an event breakdown table.
- **Path to final** — round by round, who a player could still meet on the
  way to the final, with the likely opponent flagged.
- **Match alerts** — follow a player, or a club for its members' results, and
  get a web push when a match is close and when it ends. The bell also carries
  site-wide notices: new tournaments, newly published schedules and new
  rankings.
- **Share and export** — the bracket as a JPG, or a single match / team
  schedule as an image.
- **Accessibility and comfort** — three text sizes, dark mode, EN/TH toggle.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Cheerio for scraping ·
`playwright-core` + `@sparticuz/chromium` for the BWF pages that need a real
browser to clear Cloudflare · `web-push` for alerts · PostHog for analytics ·
Jest + React Testing Library (200+ test files in `__tests__/`).

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). The app scrapes live
upstream pages, so a working internet connection is needed; responses are
cached under `.cache/` as you browse.

`npm run dev` runs the instrumentation hook too, so a local server does the
same ~90 s cache pre-warm and background discovery against live BAT as
production does. Expect the first minute or two to be busy.

```bash
npm test          # jest
npm run test:watch
npm run lint
npm run build
```

### Environment

Everything is optional — each feature simply stays off when its variables are
unset. See [.env.example](.env.example) for the full annotated list.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project key. Unset disables analytics. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Override the ingestion host. Defaults to the same-origin `/ingest` proxy so ad-blockers don't drop events. |
| `BMSTATS_PASSWORD` | Password for the `/bmstats` server status page. Unset means nobody can log in. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push for match alerts. Generate once with `npx web-push generate-vapid-keys`. With any of the three unset there is no follow button and nothing is sent. **Don't rotate the pair** once people have followed someone — existing subscriptions would go silent. |

## How it works

API routes under `app/api/` do all scraping server-side, which sidesteps CORS
and lets responses be cached and shared between visitors. On boot,
`instrumentation.ts` pre-warms the bracket, draws and schedule caches for every
tournament listed in `public/tournaments.txt` (~90 s), then keeps running
background work: tournament discovery, player-index rebuilds, the ranking
scheduler and the push watcher. Disk state — caches, access logs, push
subscriptions — lives in `.cache/`.

That background work is skipped on Vercel, where each request is a short-lived
function; `vercel.json` only raises the limits for the two slowest scraping
routes. Production is self-hosted under PM2 (`ecosystem.config.js`).

## Layout

```
app/              routes — bracket view, leaderboards, player, country matrix, bmstats
app/api/          server-side scraping and data endpoints
components/       React components (bracket canvas, modals, panels)
lib/              scraping, caching and domain logic
  providers/      BAT and BWF data providers
  ranking/        ranking fetch, projection, player detail
  points/         BAT points tables
  push/           match alerts — store, watcher, sender
__tests__/        Jest tests, with HTML fixtures in fixtures/
docs/             feature plans, specs and operational notes
```

## More

- [DEPLOY.md](DEPLOY.md) — deploying, logs, caching hazards, and triage.
- [docs/adding-bwf-tournaments.md](docs/adding-bwf-tournaments.md) — adding a
  BWF tournament.
- [docs/uptime-monitoring.md](docs/uptime-monitoring.md) — uptime checks.
- [docs/superpowers/plans/](docs/superpowers/plans/) — the implementation plan
  behind each feature, oldest first.
- `/bmstats` — live server status, cache sizes, upstream call counts and alert
  delivery for the day (password-protected).
