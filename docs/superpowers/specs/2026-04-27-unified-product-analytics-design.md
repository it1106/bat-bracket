# Unified Product Analytics — Design

**Date:** 2026-04-27
**Branch:** `analytic`
**Status:** Approved for implementation planning

## Problem

The app currently has `@vercel/analytics` and `@vercel/speed-insights` in `app/layout.tsx`. Those produce the visitor / page-view / country / device dashboards on `bat-bracket.vercel.app`, but:

1. They only capture traffic that goes through Vercel — the self-hosted `ezebat.lan` deployment is invisible.
2. They cannot answer product questions like *which tournaments draw the most attention*, *which players are people researching*, or *what is the TH/EN split*.

We want one dashboard, fed by both deployments, that reproduces the Vercel-style top-line cards and adds bracket-specific event tracking.

## Goals

- One dashboard combining traffic from both `bat-bracket.vercel.app` and `ezebat.lan`.
- Reproduce the Vercel screenshots (visitors, page views, bounce rate, country / device / OS / browser breakdowns).
- Add custom events for tournament opens, draw opens, match views, player profile views, and H2H views.
- Per-event filters for `app_deployment`, `app_language`, `app_theme`.
- Zero impact on the app when the analytics key is missing (local dev, forks, PR previews).

## Non-goals

- Embedded analytics page inside the app (`/admin/analytics`). Use PostHog's UI directly for now.
- Self-hosting PostHog. Use PostHog Cloud (EU region).
- A cookie consent banner. EU traffic is currently <0.5%; defer until that exceeds ~5%.
- Reverse-proxying PostHog through our own domain to bypass ad-blockers. Defer until we observe a meaningful gap between Vercel Analytics and PostHog counts.
- Server-side event capture. All events fire from the browser.
- Live-score watch-duration heartbeat events and day-tab / playing-order interaction events. (Possible follow-up after first look at the data.)

## Architecture

### Hosting

PostHog Cloud, EU region (`https://eu.i.posthog.com`). One project receives events from both deployments, distinguished by an `app_deployment` global property.

### Configuration

Two public env vars (browser-shipped):

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | yes (in production) | unset | If unset, the provider no-ops entirely. |
| `NEXT_PUBLIC_POSTHOG_HOST` | no | `https://eu.i.posthog.com` | Override only if migrating region or self-hosting later. |

Set on Vercel via Project → Settings → Environment Variables (Production scope). Set on `ezebat.lan` by writing `/root/app/.env.production.local` and running `pm2 restart bat-bracket --update-env`.

### Code surface

Two new files plus three small edits:

- **New:** `lib/analytics.ts` — thin helper exporting `track(event, props)`. Wraps `posthog.capture` so the rest of the codebase never imports `posthog-js` directly.
- **New:** `lib/PostHogProvider.tsx` — client component. On mount, calls `posthog.init()` if `NEXT_PUBLIC_POSTHOG_KEY` is set, else no-ops. Registers global properties (`app_deployment`, `app_language`, `app_theme`) via `posthog.register()` and re-registers on language/theme change.
- **Edit:** `app/layout.tsx` — wrap `{children}` in `<PostHogProvider>` (sibling of `LanguageProvider` / `ThemeProvider`).
- **Edit:** `app/page.tsx` — `useEffect`s on `selectedTournament` and `selectedDraw` calling `track('tournament_opened', …)` and `track('draw_opened', …)`.
- **Edit:** `components/MatchSchedule.tsx`, `components/PlayerModal.tsx`, `components/H2HModal.tsx` — call `track(...)` from the existing match-row click handler / modal-open paths.

The PostHog package is contained to `lib/PostHogProvider.tsx` and `lib/analytics.ts`. Other files import only the `track` helper.

### Source-tagging

`app_deployment` is derived at runtime, not from an env var:

```ts
const host = window.location.host
const deployment = host.endsWith('.vercel.app') ? 'vercel' : 'self-hosted'
```

If Vercel is ever turned off, no code change is needed — traffic just stops arriving with `app_deployment = vercel`.

## Event catalog

### Auto-captured

`$pageview` fires once on app load. PostHog server-side enriches it with country, device type, OS, browser, and referrer from IP and User-Agent. This alone produces the Vercel-style top-line cards.

### Global properties (attached to every event)

| Property | Source |
|---|---|
| `app_deployment` | `'vercel'` if `window.location.host.endsWith('.vercel.app')`, else `'self-hosted'`. |
| `app_language` | `LanguageContext` current value (`'en'` / `'th'`). |
| `app_theme` | `ThemeContext` current value (`'light'` / `'dark'`). |

Re-registered on language or theme change so subsequent events carry the new values.

### Custom events

| Event | Fires when | Properties |
|---|---|---|
| `tournament_opened` | `selectedTournament` changes to a non-empty value (every switch fires) | `tournament_id`, `tournament_name` |
| `draw_opened` | `selectedDraw` changes to a non-empty value (every switch fires) | `tournament_id`, `tournament_name`, `draw_id`, `draw_name` |
| `match_viewed` | First interaction (player click / H2H click / event badge click) with a specific match in `MatchSchedule`, deduped via a session-scoped `Set` of match IDs | `tournament_id`, `match_id`, `round_name`, `draw_id`, `is_live`, `is_completed` |
| `player_profile_viewed` | `handlePlayerClick` fires (i.e., user clicks any player name) | `player_id`, `tournament_id` |
| `h2h_viewed` | `handleH2HClick` fires (i.e., user clicks H2H button on a match) | `tournament_id`, `match_id` |
| `language_changed` | Language toggled | `from`, `to` |
| `theme_changed` | Theme toggled | `from`, `to` |

## Privacy & identification

- **Anonymous only.** PostHog generates a `distinct_id`, persisted in `localStorage`. No `posthog.identify()` calls — there is no logged-in user concept.
- **No PII.** `player_name` is public bracket data, not personal data.
- **IP** is sent to PostHog for GeoIP enrichment (default).
- **Bot filtering** is default-on in PostHog Cloud.
- **Cookie consent banner** is deferred. A `// TODO(consent): add cookie banner if EU traffic exceeds ~5%` comment lives in `lib/PostHogProvider.tsx`. The future fix is a banner that delays `posthog.opt_in_capturing()` until accepted.

## Testing

### Unit

One Jest test in `__tests__/analytics.test.ts`:

- When `NEXT_PUBLIC_POSTHOG_KEY` is unset, `track('x', {})` does not throw and does not call into `posthog-js`.

### Manual verification (primary)

PostHog's **Live Events** view streams events in real time (~2 s latency). The verification loop:

1. Run `npm run dev` with `NEXT_PUBLIC_POSTHOG_KEY` set in `.env.local`.
2. Open the app, switch tournaments, open a match, open a player modal, open H2H, toggle language and theme.
3. Confirm in Live Events that each expected event fires once with the right properties and global properties.

### Deployment verification

After deploying to each environment, filter Live Events by `app_deployment = self-hosted` (then `= vercel`) and confirm events appear from each.

## Rollout

1. Cut branch `analytic` from `main` at `269f464` (done).
2. Implement on branch; verify locally.
3. Deploy `analytic` to `ezebat.lan` first (lower-stakes audience). Set env vars in `/root/app/.env.production.local`, `pm2 restart bat-bracket --update-env`. Verify in PostHog.
4. Merge `analytic` → `main`, push. Vercel auto-deploys. Set the same env vars in Vercel Project Settings (Production scope). Verify in PostHog.

## Rollback

Unset `NEXT_PUBLIC_POSTHOG_KEY` in the affected environment and redeploy. The provider no-ops; the app is otherwise unaffected.

## Future considerations (out of scope)

- Cookie consent banner if EU traffic grows.
- Reverse-proxying PostHog through `bat-bracket.vercel.app/ingest/*` to bypass ad-blockers.
- Live-score watch-duration heartbeat events.
- Day-tab and playing-order pill interaction events.
- An embedded `/admin/analytics` page in the Next app.
- Self-hosting PostHog on `ezebat.lan` (would require Postgres + ClickHouse + Kafka + Redis, ~6 GB RAM minimum).
