'use client'

import { toJpeg, getFontEmbedCSS } from 'html-to-image'

// html-to-image fetches and base64-encodes every page font on each toJpeg
// call (~1s on iOS Safari first time, cached after). We resolve it once
// per session and pass the result via the `fontEmbedCSS` option so each
// capture skips the fetch — critical for fitting capture inside the 1s
// long-press hold window on a cold page load.
let fontEmbedCSSPromise: Promise<string> | null = null

export function prewarmFontEmbedCSS(): Promise<string> {
  if (fontEmbedCSSPromise) return fontEmbedCSSPromise
  fontEmbedCSSPromise = getFontEmbedCSS(document.body).catch((err) => {
    console.warn('prewarmFontEmbedCSS failed', err)
    fontEmbedCSSPromise = null
    return ''
  })
  return fontEmbedCSSPromise
}

interface CaptureMatchImageOptions {
  matchEl: HTMLElement
  tournamentName: string
  filename: string
  scheduledTime?: string
  scheduledDateLabel?: string
}

interface ShareFileOptions {
  file: File
}

const HIGHLIGHT_CLASSES = ['ms-match--active', 'ms-match--next-opp', 'ms-match--tracked', 'ms-match--pressing']
const FILENAME_MAX = 80

function buildSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

export function buildFilename(tournamentName: string, eventName: string): string {
  const base = `${buildSlug(tournamentName)}-${buildSlug(eventName)}-${Date.now()}.jpg`
  return base.length > FILENAME_MAX ? base.slice(0, FILENAME_MAX - 4) + '.jpg' : base
}

function buildHeader(tournamentName: string): HTMLElement {
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 12px 14px;
    border-bottom: 2px solid #dee2e6;
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: white;
    font-size: 13px;
    font-weight: 600;
    color: #333;
  `
  header.textContent = tournamentName
  return header
}

function cleanClone(
  matchEl: HTMLElement,
  opts: { scheduledTime?: string; scheduledDateLabel?: string } = {},
): HTMLElement {
  const clone = matchEl.cloneNode(true) as HTMLElement
  for (const cls of HIGHLIGHT_CLASSES) clone.classList.remove(cls)
  clone.querySelectorAll('.ms-player-highlight').forEach((el) => el.classList.remove('ms-player-highlight'))
  clone.querySelectorAll('.ms-h2h-inline').forEach((el) => el.remove())
  const meta = clone.querySelector('.ms-meta')
  if (meta) {
    // Inline styles so the capture renders consistently even outside the
    // app's CSS context (e.g. jsdom in tests, edge browser quirks).
    const stampStyle = 'font-size:12px;font-weight:600;color:#1a1a1a;white-space:nowrap;'
    if (opts.scheduledDateLabel) {
      const dateEl = document.createElement('span')
      dateEl.className = 'ms-date'
      dateEl.textContent = opts.scheduledDateLabel
      dateEl.style.cssText = stampStyle
      meta.appendChild(dateEl)
    }
    if (opts.scheduledTime) {
      const timeEl = document.createElement('span')
      timeEl.className = 'ms-time'
      timeEl.textContent = opts.scheduledTime
      timeEl.style.cssText = stampStyle
      meta.appendChild(timeEl)
    }
  }
  return clone
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], filename, { type: 'image/jpeg' })
}

export async function captureMatchImageFile(opts: CaptureMatchImageOptions): Promise<File> {
  const { matchEl, tournamentName, filename, scheduledTime, scheduledDateLabel } = opts

  const wrapper = document.createElement('div')
  // The wrapper has to be in the DOM at a real on-screen position for iOS
  // Safari to rasterize it (off-screen produces a blank canvas), but we put
  // it behind the page with z-index:-1 so the user never sees it flash.
  // The .ms-share-capture class redefines CSS variables to light-mode
  // values in its subtree so we don't have to toggle html.dark globally.
  wrapper.className = 'ms-share-capture'
  wrapper.style.cssText = `
    position: fixed; left: 0; top: 0; width: 380px;
    background: #ffffff; font-family: 'Segoe UI', system-ui, sans-serif;
    z-index: -1; pointer-events: none;
  `
  wrapper.appendChild(buildHeader(tournamentName))
  wrapper.appendChild(cleanClone(matchEl, { scheduledTime, scheduledDateLabel }))
  document.body.appendChild(wrapper)

  if (document.fonts?.ready) {
    try { await document.fonts.ready } catch { /* ignore */ }
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

  const fullWidth = wrapper.scrollWidth
  const fullHeight = wrapper.scrollHeight
  const fontEmbedCSS = await prewarmFontEmbedCSS()

  try {
    const dataUrl = await toJpeg(wrapper, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width: fullWidth,
      height: fullHeight,
      fontEmbedCSS,
    })
    return await dataUrlToFile(dataUrl, filename)
  } finally {
    document.body.removeChild(wrapper)
  }
}

// Synchronous entry: must be called inside a user-gesture handler chain
// (touchend / click) with no awaits between the gesture and this call.
// iOS Safari otherwise drops transient activation and rejects share().
// Files-only payload: title/text get prefilled as a message in iOS LINE,
// which we don't want — image-only matches Android behavior.
export function shareFile(opts: ShareFileOptions): void {
  const { file } = opts
  const hasShare = typeof navigator.share === 'function'
  const canShareFiles = typeof navigator.canShare === 'function'
    ? navigator.canShare({ files: [file] })
    : hasShare
  if (!hasShare || !canShareFiles) return
  navigator
    .share({ files: [file] })
    .catch(() => { /* swallow — no fallback */ })
}

interface CaptureStatsImageOptions {
  sectionEl: HTMLElement
  tournamentName: string
  filename: string
}

// Mirrors captureMatchImageFile but for stats-panel sections. The wrapper
// is force-narrow (400px) and tagged with .stats-share-capture so the
// mobile-view CSS overrides kick in regardless of the user's viewport.
export async function captureStatsImageFile(opts: CaptureStatsImageOptions): Promise<File> {
  const { sectionEl, tournamentName, filename } = opts

  const wrapper = document.createElement('div')
  wrapper.className = 'ms-share-capture stats-share-capture'
  wrapper.style.cssText = `
    position: fixed; left: 0; top: 0; width: 400px;
    background: #ffffff; font-family: 'Segoe UI', system-ui, sans-serif;
    z-index: -1; pointer-events: none;
  `
  wrapper.appendChild(buildHeader(tournamentName))

  // Wrap the cloned section in a stats-panel so descendant selectors like
  // .stats-section work. Padding gives the section breathing room from the
  // header and wrapper edges.
  const panel = document.createElement('div')
  panel.className = 'stats-panel'
  panel.style.cssText = 'padding: 10px 14px 14px;'

  const clone = sectionEl.cloneNode(true) as HTMLElement
  clone.classList.remove('stats-share-pressing', 'stats-share-ready')
  panel.appendChild(clone)
  wrapper.appendChild(panel)
  document.body.appendChild(wrapper)

  if (document.fonts?.ready) {
    try { await document.fonts.ready } catch { /* ignore */ }
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

  const fullWidth = wrapper.scrollWidth
  const fullHeight = wrapper.scrollHeight
  const fontEmbedCSS = await prewarmFontEmbedCSS()

  try {
    const dataUrl = await toJpeg(wrapper, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width: fullWidth,
      height: fullHeight,
      fontEmbedCSS,
    })
    return await dataUrlToFile(dataUrl, filename)
  } finally {
    document.body.removeChild(wrapper)
  }
}

export async function shareMatchAsImage(opts: { matchEl: HTMLElement; tournamentName: string; eventName: string; scheduledTime?: string; scheduledDateLabel?: string }): Promise<void> {
  const filename = buildFilename(opts.tournamentName, opts.eventName)
  let file: File
  try {
    file = await captureMatchImageFile({ matchEl: opts.matchEl, tournamentName: opts.tournamentName, filename, scheduledTime: opts.scheduledTime, scheduledDateLabel: opts.scheduledDateLabel })
  } catch (err) {
    console.warn('shareMatchAsImage: capture failed', err)
    return
  }
  shareFile({ file })
}
