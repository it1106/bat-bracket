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
 * the same fields the app's resolver would, and write the sidecar entry.
 *
 * TWO PATHS, same as lib/providers/bwf/url-resolver-runtime.ts:
 *   1. page HTML — the regexes below mirror url-resolver.ts.
 *   2. vue-tournament-detail API (keyed by the tmtId in the URL) when the HTML
 *      path comes up short. That happens for more than Cloudflare: a tournament
 *      that has not started yet has no results, so its page lands on a Draw tab
 *      whose <title> reads "Draw MD U15 - <Name>" instead of the usual
 *      "Results | <Name>", and the name regex (which keys off the "|") misses.
 *      Observed on tmtId 5774, four days before its start date; the runtime
 *      resolver hits the same wall and recovers the same way.
 * Either path writes what the resolver would write for that path, so the result
 * stays a safe shortcut rather than a hand-made entry.
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
 * The regexes and the detail-API mapping below mirror
 * lib/providers/bwf/url-resolver.ts. If resolution logic changes there, update
 * them here too (the script validates the fields it found and prints which path
 * produced the entry, so drift surfaces as a failure).
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
const PRIMER_URL = 'https://bwfbadminton.com/calendar/'
const API_HOST = 'https://extranet-lv.bwfbadminton.com'

// --- mirrors lib/providers/bwf/url-resolver.ts ---
const RX = {
  tmtId: /\bmainTmtId\s*:\s*(\d+)/,
  tournamentCode: /\btournamentCode\s*:\s*['"]([0-9A-Fa-f-]{36})['"]/,
  slug: /\btournamentSlug\s*:\s*['"]([^'"]+)['"]/,
  name: /<title>\s*[^|<]*\|\s*([^<]+?)\s*<\/title>/,
  token: /(?:&quot;|["'])?\btoken\b(?:&quot;|["'])?\s*:\s*(?:&quot;|["'])([^"'&]+)(?:&quot;|["'])/,
}
const TMT_ID_IN_URL = /\/tournament\/(\d+)(?:\/|$)/
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

// mirrors isoDateOnly() in url-resolver.ts
function isoDateOnly(raw) {
  if (typeof raw !== 'string') return ''
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim())
  return m ? m[1] : ''
}

// mirrors sidecarFieldsFromDetail() in url-resolver.ts
function fieldsFromDetail(results) {
  if (!results || typeof results !== 'object') return null
  const id = typeof results.id === 'number' ? results.id : Number(results.id)
  const code = typeof results.code === 'string' ? results.code : ''
  const name = typeof results.name === 'string' ? results.name : ''
  const slug = typeof results.slug === 'string' ? results.slug : ''
  if (!Number.isFinite(id) || !code || !name || !slug) return null
  return {
    tmtId: id,
    tournamentCode: code.toUpperCase(),
    slug,
    name,
    startDateIso: isoDateOnly(results.start_date),
    endDateIso: isoDateOnly(results.end_date),
  }
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' })
  try {
    // Prime via the calendar page first: warms Cloudflare clearance and yields
    // the API bearer token, exactly as cf-context.ts prime() does. Keep the page
    // open — a same-origin page is what makes the API fetch survive Cloudflare.
    const apiPage = await ctx.newPage()
    await apiPage.goto(PRIMER_URL, { waitUntil: 'load' }).catch(() => {})
    const primerToken = (RX.token.exec(await apiPage.content()) || [])[1] || null

    const p = await ctx.newPage()
    const resp = await p.goto(URL_KEY, { waitUntil: 'load', timeout: 40000 }).catch(() => null)
    const status = resp ? resp.status() : 0
    const html = status === 200 ? await p.content() : ''
    await p.close()

    let entry = null
    let via = ''

    if (html) {
      const meta = {
        tmtId: RX.tmtId.exec(html) && RX.tmtId.exec(html)[1],
        tournamentCode: RX.tournamentCode.exec(html) && RX.tournamentCode.exec(html)[1],
        slug: RX.slug.exec(html) && RX.slug.exec(html)[1],
        name: RX.name.exec(html) && RX.name.exec(html)[1],
        token: RX.token.exec(html) && RX.token.exec(html)[1],
      }
      const missing = Object.entries(meta).filter(([, v]) => !v).map(([k]) => k)
      if (missing.length) {
        console.error(`page HTML incomplete (missing: ${missing.join(', ')}) — falling back to the detail API`)
      } else {
        const dates = extractDates(html)
        entry = {
          tmtId: Number(meta.tmtId),
          tournamentCode: meta.tournamentCode.toUpperCase(),
          slug: meta.slug,
          name: meta.name,
          startDateIso: dates.startDateIso,
          endDateIso: dates.endDateIso,
        }
        via = 'page HTML'
      }
    } else {
      console.error(`page fetch returned HTTP ${status} (Cloudflare challenge?) — falling back to the detail API`)
    }

    if (!entry) {
      const tmtId = (TMT_ID_IN_URL.exec(URL_KEY) || [])[1]
      if (!tmtId) fail('no tmtId in the URL, so the detail API cannot be keyed — expected /tournament/<id>/<slug>/')
      const token = (html && RX.token.exec(html) ? RX.token.exec(html)[1] : null) || primerToken
      if (!token) fail('no bearer token from either the tournament page or the calendar primer — cannot call the detail API')

      const res = await apiPage.evaluate(async (arg) => {
        const r = await fetch(arg.url, {
          headers: { Authorization: `Bearer ${arg.token}`, 'Content-Type': 'application/json' },
        })
        let data = null
        try { data = await r.json() } catch { /* non-JSON */ }
        return { status: r.status, data }
      }, { url: `${API_HOST}/api/vue-tournament-detail?tmtId=${tmtId}`, token })

      if (res.status !== 200) fail(`detail API returned HTTP ${res.status} for tmtId=${tmtId}`)
      entry = fieldsFromDetail(res.data && res.data.results)
      if (!entry) fail(`detail API response missing identity fields for tmtId=${tmtId} — check sidecarFieldsFromDetail in lib/providers/bwf/url-resolver.ts`)
      via = 'vue-tournament-detail API'
    }

    entry.resolvedAt = new Date().toISOString()

    const cachePath = path.join(process.cwd(), 'public', 'bwf-cache.json')
    const backup = `${cachePath}.bak.${Date.now()}`
    fs.copyFileSync(cachePath, backup)
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    cache[URL_KEY] = entry
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))

    console.log('resolved via:', via)
    console.log('backup written:', backup)
    console.log('seeded entry:\n' + JSON.stringify(entry, null, 2))
    console.log('\nNext: `pm2 reload bat-bracket`, then check /api/tournaments for the event.')
  } finally {
    await browser.close()
  }
})().catch((err) => { console.error('failed:', err.message); process.exit(1) })
