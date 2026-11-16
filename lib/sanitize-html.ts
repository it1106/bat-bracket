import * as cheerio from 'cheerio'

// Cleans HTML that someone outside this project wrote — the regulations and
// notes a tournament organiser types into BAT — before it is put on our page
// as HTML.
//
// It works from a list of what is allowed, not of what is dangerous: the
// markup is parsed, and a new string is written out holding only the elements
// and attributes named below, with all text and attribute values escaped.
// Anything not named is left out, so a tag or attribute nobody thought of is
// harmless by default. Formatting survives; nothing that can run, load, frame
// or restyle the page does.

/** One node of the parsed markup, as cheerio (domhandler) holds it. */
interface HtmlNode {
  type: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: HtmlNode[]
}

const BAT_ORIGIN = 'https://bat.tournamentsoftware.com'

// Elements written out again. Any other element is unwrapped: its tag goes,
// its (cleaned) contents stay — so a <center> or <font> costs no text.
const KEEP = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'br', 'hr', 'p', 'div', 'span', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'img',
])
const VOID = new Set(['br', 'hr', 'img'])

// Elements that go together with everything inside them: what they hold is
// code, styling, another document or a form control, never text to show.
const DROP = new Set([
  'script', 'style', 'template', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext', 'listing',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math',
  'head', 'title', 'link', 'meta', 'base',
  'input', 'button', 'select', 'option', 'optgroup', 'datalist', 'textarea',
  'audio', 'video', 'source', 'track', 'canvas', 'map', 'area', 'dialog',
])

const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const IMAGE_SCHEMES = new Set(['http:', 'https:'])

// The few style properties organisers use to colour and align text, and the
// plain values they may take. No url(), no var(), no functions but colours.
const STYLE_PROPS = new Set(['color', 'background-color', 'text-align', 'font-weight', 'font-style', 'text-decoration'])
const STYLE_VALUE = /^(?:#[0-9a-f]{3,8}|[a-z][a-z -]*|\d{3}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%]+\))$/i

const escText = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
const escAttr = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** An address as a browser would read it — relative ones against BAT, where
 *  the markup came from — or null unless its scheme is one of `schemes`. */
function safeUrl(value: string | undefined, schemes: Set<string>): string | null {
  if (!value) return null
  try {
    const url = new URL(value, BAT_ORIGIN)
    return schemes.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function safeStyle(value: string | undefined): string | null {
  if (!value) return null
  const kept: string[] = []
  for (const part of value.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const prop = part.slice(0, colon).trim().toLowerCase()
    const val = part.slice(colon + 1).trim()
    if (STYLE_PROPS.has(prop) && STYLE_VALUE.test(val)) kept.push(`${prop}:${val}`)
  }
  return kept.length > 0 ? kept.join(';') : null
}

const digits = (value: string | undefined, max: number) =>
  value && new RegExp(`^\\d{1,${max}}$`).test(value.trim()) ? value.trim() : null

/** The attributes to write for a kept element, or null when the element
 *  should not be written at all (a picture with no usable address). */
function attributesFor(name: string, attribs: Record<string, string>): Array<[string, string]> | null {
  const out: Array<[string, string]> = []
  const add = (key: string, value: string | null) => { if (value !== null) out.push([key, value]) }
  if (name === 'a') {
    // An in-page anchor pointed at a place on BAT's own page, not ours.
    const inPage = (attribs.href ?? '').trim().startsWith('#')
    add('href', inPage ? null : safeUrl(attribs.href, LINK_SCHEMES))
    // Every link leaves the site, and the page it opens gets no handle on ours.
    out.push(['target', '_blank'], ['rel', 'noopener noreferrer nofollow'])
  } else if (name === 'img') {
    const src = safeUrl(attribs.src, IMAGE_SCHEMES)
    if (!src) return null
    out.push(['src', src])
    add('alt', attribs.alt ?? null)
    add('width', digits(attribs.width, 4))
    add('height', digits(attribs.height, 4))
  } else if (name === 'td' || name === 'th') {
    add('colspan', digits(attribs.colspan, 3))
    add('rowspan', digits(attribs.rowspan, 3))
  }
  add('style', safeStyle(attribs.style))
  return out
}

function write(node: HtmlNode): string {
  if (node.type === 'text') return escText(node.data ?? '')
  // Elements only from here: comments, doctypes and the like are left out.
  if (!node.name) return ''
  const name = node.name.toLowerCase()
  if (DROP.has(name)) return ''
  const inner = (node.children ?? []).map(write).join('')
  if (!KEEP.has(name)) return inner
  const attrs = attributesFor(name, node.attribs ?? {})
  if (!attrs) return ''
  const open = `<${name}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}>`
  return VOID.has(name) ? open : `${open}${inner}</${name}>`
}

/** Cleans already-parsed nodes (e.g. `$(el).contents().toArray()`). */
export function sanitizeNodes(nodes: ArrayLike<unknown>): string {
  return Array.from(nodes as ArrayLike<HtmlNode>).map(write).join('')
}

/** Cleans a fragment of HTML. Running it over its own output changes nothing. */
export function sanitizeHtml(html: string): string {
  const $ = cheerio.load(html, null, false)
  return sanitizeNodes($.root().contents().toArray())
}
