import * as cheerio from 'cheerio'
import { sanitizeHtml } from '@/lib/sanitize-html'

// What a browser would make of the result: the elements and attributes that
// are really there, whatever the string looks like.
const dom = (html: string) => cheerio.load(sanitizeHtml(html), null, false)

describe('sanitizeHtml keeps ordinary organiser formatting', () => {
  it.each([
    ['line breaks', 'one<br>two', 'one<br>two'],
    ['paragraphs and emphasis', '<p><strong>Bold</strong> and <em>soft</em></p>', '<p><strong>Bold</strong> and <em>soft</em></p>'],
    ['lists', '<ul><li>a</li><li>b</li></ul>', '<ul><li>a</li><li>b</li></ul>'],
    ['a table with spans', '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>', '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>'],
    ['thai text and symbols', 'คู่ละ 1,200 บาท &amp; 5 &lt; 6', 'คู่ละ 1,200 บาท &amp; 5 &lt; 6'],
  ])('%s', (_label, input, want) => {
    expect(sanitizeHtml(input)).toBe(want)
  })

  it('keeps a web link, and makes it open safely in a new tab', () => {
    expect(sanitizeHtml('<a href="https://example.org/entry?a=1&amp;b=2">Entry form</a>'))
      .toBe('<a href="https://example.org/entry?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">Entry form</a>')
  })

  it('points a BAT-relative link at BAT, not at this site', () => {
    const $ = dom('<a href="/tournament/abc/players">Players</a>')
    expect($('a').attr('href')).toBe('https://bat.tournamentsoftware.com/tournament/abc/players')
  })

  it('keeps mail and phone links', () => {
    expect(dom('<a href="mailto:club@example.org">mail</a>')('a').attr('href')).toBe('mailto:club@example.org')
    expect(dom('<a href="tel:+6621234567">call</a>')('a').attr('href')).toBe('tel:+6621234567')
  })

  // An in-page anchor meant a place on BAT's page; here it would lead nowhere.
  it('keeps the words of an in-page link but not its address', () => {
    const $ = dom('<a href="#fees">Fees</a>')
    expect($('a').attr('href')).toBeUndefined()
    expect($('a').text()).toBe('Fees')
  })

  it('keeps a picture served over the web, with its size and description', () => {
    const $ = dom('<img src="https://example.org/map.png" alt="Venue map" width="300" height="200" onload="x()">')
    expect($('img').attr()).toEqual({ src: 'https://example.org/map.png', alt: 'Venue map', width: '300', height: '200' })
  })

  it('keeps simple colour and alignment, and nothing else of a style', () => {
    const $ = dom('<p style="color: red; text-align:center; position:fixed; top:0; background:url(https://x.example/t.gif)">x</p>')
    expect($('p').attr('style')).toBe('color:red;text-align:center')
  })

  it('unwraps an element it does not know, keeping its text', () => {
    expect(sanitizeHtml('<center><font color="red">Welcome</font></center>')).toBe('Welcome')
  })
})

describe('sanitizeHtml removes everything that can run or mislead', () => {
  it.each([
    ['a script', 'a<script>alert(1)</script>b'],
    ['a stylesheet', 'a<style>body{display:none}</style>b'],
    ['a frame', 'a<iframe src="https://evil.example"></iframe>b'],
    ['a frame with inline content', 'a<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>b'],
    ['an embedded object', 'a<object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x.swf">b'],
    ['an svg with a script', 'a<svg><script>alert(1)</script></svg>b'],
    ['an svg load handler', 'a<svg onload="alert(1)"></svg>b'],
    ['maths markup', 'a<math><mtext><script>alert(1)</script></mtext></math>b'],
    ['form controls', 'a<input name="q"><button>Go</button><select><option>1</option></select><textarea>t</textarea>b'],
    ['a base tag', 'a<base href="https://evil.example/">b'],
    ['a meta refresh', 'a<meta http-equiv="refresh" content="0;url=https://evil.example">b'],
    ['a stylesheet link', 'a<link rel="stylesheet" href="https://evil.example/x.css">b'],
    ['a comment', 'a<!-- <script>alert(1)</script> -->b'],
  ])('%s, contents and all', (_label, input) => {
    expect(sanitizeHtml(input)).toBe('ab')
  })

  it.each([
    ['onclick', '<p onclick="alert(1)">x</p>'],
    ['onerror', '<img src="https://example.org/a.png" onerror="alert(1)">'],
    ['an upper-case handler', '<p ONMOUSEOVER="alert(1)">x</p>'],
    ['id and class', '<p id="main" class="modal">x</p>'],
    ['bootstrap wiring', '<a href="https://example.org/" data-toggle="collapse" data-target="#x" aria-expanded="false">x</a>'],
    ['form hijacking', '<p formaction="https://evil.example" contenteditable="true">x</p>'],
  ])('drops %s attributes', (_label, input) => {
    const $ = dom(input)
    const allowed = new Set(['href', 'target', 'rel', 'src'])
    $('*').each((_i, el) => {
      for (const name of Object.keys((el as { attribs?: Record<string, string> }).attribs ?? {})) {
        expect(allowed.has(name)).toBe(true)
      }
    })
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    '&#106;avascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('drops the address of a link to %j but keeps its words', (href) => {
    const $ = dom(`<a href="${href.replace(/"/g, '&quot;')}">click</a>`)
    expect($('a').attr('href')).toBeUndefined()
    expect($('a').text()).toBe('click')
  })

  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'file:///x.png'])(
    'drops a picture whose address is %j',
    (src) => {
      expect(dom(`<p>x<img src="${src}"></p>`)('img')).toHaveLength(0)
    },
  )

  it('drops a style that tries to load or run something', () => {
    const $ = dom('<p style="color:expression(alert(1))">a</p><p style="background-color:url(x)">b</p><p style="color:var(--x)">c</p>')
    $('p').each((_i, el) => { expect($(el).attr('style')).toBeUndefined() })
  })

  it('escapes text that looks like markup instead of letting it become markup', () => {
    const out = sanitizeHtml('&lt;img src=x onerror=alert(1)&gt;')
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;')
    expect(cheerio.load(out, null, false)('img')).toHaveLength(0)
  })

  it('does not let an attribute value break out of its quotes', () => {
    const $ = dom('<img src="https://example.org/a.png" alt="x&quot; onerror=&quot;alert(1)">')
    expect($('img').attr('onerror')).toBeUndefined()
    expect($('img').attr('alt')).toBe('x" onerror="alert(1)')
  })

  it('cleans what is hidden inside an element it unwraps', () => {
    expect(sanitizeHtml('<center><script>alert(1)</script><b onclick="x()">hi</b></center>')).toBe('<b>hi</b>')
  })

  it('gives the same result when run over its own output', () => {
    const once = sanitizeHtml('<p style="color: red">a <a href="/x">b</a><img src="https://example.org/a.png" alt="&lt;&quot;"></p><script>1</script>')
    expect(sanitizeHtml(once)).toBe(once)
  })
})
