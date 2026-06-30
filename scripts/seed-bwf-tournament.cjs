#!/usr/bin/env node
/*
 * Seed a BWF tournament into public/bwf-cache.json without waiting on the
 * app's live resolver.
 *
 * WHY THIS EXISTS
 * ---------------
 * Adding a BWF event normally just means a `@bwf <url>` line in
 * public/tournaments.txt; the app then resolves it lazily by scraping the page
 * via its long-lived headless-Chromium context. But bwfbadminton.com sits
 * behind Cloudflare, and that reused context frequently gets 403-challenged on
 * tournament pages (fetchPageHtml has no 403 re-prime, unlike request()), so a
 * brand-new event can fail to resolve for a long time — you see repeated
 * "[bwf-resolve] could not extract meta" in the logs.
 *
 * A FRESH headless-Chromium launch reliably gets HTTP 200 with all fields. This
 * script does exactly that: fetch the page once in a throwaway browser, extract
 * the same fields the app's resolver would, and write the sidecar entry. The
 * result is byte-identical to what the resolver produces.
 *
 * USAGE (run on a host with good Cloudflare standing — i.e. the prod server,
 * not a laptop, which CF treats more harshly):
 *
 *   cd ~/app
 *   node scripts/seed-bwf-tournament.cjs <bwf-tournament-url>
 *   pm2 reload bat-bracket        # so the running process reloads the cache
 *
 * IMPORTANT: pass the SAME url string you put in public/tournaments.txt. The
 * sidecar is keyed by exact URL; a mismatch (e.g. a trailing /results/) means
 * the parser won't find the seeded entry.
 *
 * The regexes below mirror lib/providers/bwf/url-resolver.ts. If resolution
 * logic changes there, update them here too (the script validates that all five
 * fields were found and prints the entry, so drift surfaces as a failure).
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const URL_KEY = process.argv[2]
if (!URL_KEY || !/^https?:\/\//.test(URL_KEY)) {
  console.error('usage: node scripts/seed-bwf-tournament.cjs <bwf-tournament-url>')
  console.error('  (use the exact url from public/tournaments.txt)')
  process.exit(2)
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// --- mirrors lib/providers/bwf/url-resolver.ts ---
const RX = {
  tmtId: /\bmainTmtId\s*:\s*(\d+)/,
  tournamentCode: /\btournamentCode\s*:\s*['"]([0-9A-Fa-f-]{36})['"]/,
  slug: /\btournamentSlug\s*:\s*['"]([^'"]+)['"]/,
  name: /<title>\s*[^|<]*\|\s*([^<]+?)\s*<\/title>/,
  token: /(?:&quot;|["'])?\btoken\b(?:&quot;|["'])?\s*:\s*(?:&quot;|["'])([^"'&]+)(?:&quot;|["'])/,
}
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
const YEAR_FROM_SLUG = /tournamentSlug\s*:\s*['"][^'"]*?(\d{4})['"]/
const SAME_MONTH = /class="live-date">\s*(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})/
const CROSS_MONTH = /class="live-date">\s*(\d{1,2})\s+([A-Za-z]{3,9})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})/

function extractDates(html) {
  const y = YEAR_FROM_SLUG.exec(html)
  if (!y) return { startDateIso: '', endDateIso: '' }
  const year = y[1]
  let m = CROSS_MONTH.exec(html)
  if (m) {
    const m1 = MONTHS[m[2].slice(0, 3).toLowerCase()]
    const m2 = MONTHS[m[4].slice(0, 3).toLowerCase()]
    if (m1 && m2) return { startDateIso: `${year}-${m1}-${m[1].padStart(2, '0')}`, endDateIso: `${year}-${m2}-${m[3].padStart(2, '0')}` }
  }
  m = SAME_MONTH.exec(html)
  if (m) {
    const mm = MONTHS[m[3].slice(0, 3).toLowerCase()]
    if (mm) return { startDateIso: `${year}-${mm}-${m[1].padStart(2, '0')}`, endDateIso: `${year}-${mm}-${m[2].padStart(2, '0')}` }
  }
  return { startDateIso: '', endDateIso: '' }
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' })
  try {
    // Prime via the calendar page first (warms Cloudflare clearance), same as the app.
    const p0 = await ctx.newPage()
    await p0.goto('https://bwfbadminton.com/calendar/', { waitUntil: 'load' }).catch(() => {})
    await p0.close()

    const p = await ctx.newPage()
    const resp = await p.goto(URL_KEY, { waitUntil: 'load', timeout: 40000 })
    const html = await p.content()
    const status = resp ? resp.status() : 0
    if (status !== 200) {
      console.error(`fetch returned HTTP ${status} (Cloudflare challenge?). Retry — a fresh launch usually gets 200.`)
      process.exit(1)
    }

    const meta = {
      tmtId: RX.tmtId.exec(html) && RX.tmtId.exec(html)[1],
      tournamentCode: RX.tournamentCode.exec(html) && RX.tournamentCode.exec(html)[1],
      slug: RX.slug.exec(html) && RX.slug.exec(html)[1],
      name: RX.name.exec(html) && RX.name.exec(html)[1],
      token: RX.token.exec(html) && RX.token.exec(html)[1],
    }
    const missing = Object.entries(meta).filter(([, v]) => !v).map(([k]) => k)
    if (missing.length) {
      console.error('could not extract field(s):', missing.join(', '), '- page structure may have changed; check RX vs lib/providers/bwf/url-resolver.ts')
      process.exit(1)
    }

    const dates = extractDates(html)
    const entry = {
      tmtId: Number(meta.tmtId),
      tournamentCode: meta.tournamentCode.toUpperCase(),
      slug: meta.slug,
      name: meta.name,
      startDateIso: dates.startDateIso,
      endDateIso: dates.endDateIso,
      resolvedAt: new Date().toISOString(),
    }

    const cachePath = path.join(process.cwd(), 'public', 'bwf-cache.json')
    const backup = `${cachePath}.bak.${Date.now()}`
    fs.copyFileSync(cachePath, backup)
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    cache[URL_KEY] = entry
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))

    console.log('backup written:', backup)
    console.log('seeded entry:\n' + JSON.stringify(entry, null, 2))
    console.log('\nNext: `pm2 reload bat-bracket`, then check /api/tournaments for the event.')
  } finally {
    await browser.close()
  }
})().catch((err) => { console.error('failed:', err.message); process.exit(1) })
