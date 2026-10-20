// Is this request a crawler rather than a person?
//
// /bmstats counts a user for every device that sends a presence heartbeat, and
// a page load for every /api/pageview. Crawlers that run our JavaScript —
// Applebot and Googlebot above all — send both, so the status page counted them
// as visitors while PostHog did not: posthog-js drops events from a known bot
// user agent in the browser, before they are ever sent. The two tiles disagreed
// by hundreds of users on a busy crawl day.
//
// So the same line is drawn here, server-side: the list posthog-js uses (its
// DEFAULT_BLOCKED_UA_STRS), which covers every crawler our access log shows,
// plus a few well-known agents and headless markers it leaves out.
// A plain substring check on a lowercased agent, no dependency.
//
// Only self-identifying crawlers are matched. A bare `bot` is deliberately not
// in the list: Cubot is a phone brand, so `CUBOT KINGKONG` is a person. The
// marker is `bot/`, `(bot;` or a named agent.

const MARKERS = [
  // Search and AI crawlers that render JavaScript.
  'googlebot',
  'googleother',
  'google-inspectiontool',
  'google-read-aloud',
  'storebot-google',
  'mediapartners-google',
  'apis-google',
  'adsbot',
  'applebot',
  'bingbot',
  'bingpreview',
  'msnbot',
  'duckduckbot',
  'yandex',
  'baiduspider',
  'petalbot',
  'bytespider',
  'amazonbot',
  'slurp',
  // AI assistants and answer engines.
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'perplexity',
  'claudebot',
  'anthropic-ai',
  'meta-externalagent',
  'ccbot',
  // Social and link unfurlers.
  'facebookexternalhit',
  'facebookcatalog',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'whatsapp',
  'pinterest',
  // SEO and audit crawlers.
  'semrush',
  'ahrefs',
  'mj12bot',
  'dataforseo',
  'screaming frog',
  'sitebulb',
  'rogerbot',
  'ia_archiver',
  'archive.org_bot',
  // Headless browsers, monitors and generic self-descriptions.
  'headlesschrome',
  'headless',
  'lighthouse',
  'phantomjs',
  'puppeteer',
  'playwright',
  'uptimerobot',
  'prerender',
  'bot/',
  '(bot;',
  'bot.html',
  'bot.htm',
  'bot.php',
  'spider',
  'crawler',
  'crawling',
]

/** Whether this user agent belongs to a crawler, and so must not be counted
 *  as a user or a page load on /bmstats. A missing agent counts as a person:
 *  some real browsers and privacy tools send none. */
export function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return false
  const s = ua.toLowerCase()
  return MARKERS.some((m) => s.includes(m))
}
