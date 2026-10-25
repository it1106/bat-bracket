# Editable Announcement Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sliding marquee announcement banner with a one-time modal popup whose text the site owner edits from `/bmstats`, with no deploy needed.

**Architecture:** A file-backed server store (`.cache/announcement.json`) holds the text plus a content-derived id. A login-gated route reads and writes it; a public route serves `{ id, text }` to visitors. The popup fetches that route on mount and shows when the id differs from the single id the browser has stored in localStorage, so changing the text re-shows it to everyone and re-saving the same text re-shows it to nobody.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind + `app/globals.css`, Jest (`next/jest`, node environment by default, jsdom per-file via docblock), `@testing-library/react`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-announcement-popup-design.md`

## Global Constraints

- No new dependencies. In particular `@testing-library/user-event` is **not**
  installed: component tests drive the DOM with `fireEvent` from
  `@testing-library/react`, as every existing `__tests__/*.tsx` does.
- `MAX_ANNOUNCEMENT = 500` characters, measured after trimming.
- The id is `sha256(trimmedText)` hex, first 12 characters, computed server-side only. Clients compare ids, never texts.
- Client dismissal lives in exactly one localStorage key: `batbracket.announcementSeen`.
- Server state file: `.cache/announcement.json`, shape `{ version: 1, text, id, updatedAt }`.
- Both API routes set `export const dynamic = 'force-dynamic'` and `Cache-Control: no-store`.
- The admin route's unauthorized response is `401 { error: 'login required' }`, matching `app/api/bmstats/aliases/route.ts`.
- Announcement text is rendered as a React text node, never as HTML.
- The popup ships off: no seeding from the old `ANN_CUSTOM_TABS_MULTI_TEXT_TH`.
- `/bmstats` copy is English; the announcement text is whatever the owner types.

## Review Focus

Input classes the spec implies but no task's happy-path tests would reach. Each has its test added to the task that owns the code.

1. **Text containing HTML or a `<script>` tag** — the owner can type anything; it must appear as literal characters, never as markup. (Task 4)
2. **A public fetch that fails, 500s, or returns malformed JSON** — the popup must render nothing rather than an empty modal. (Task 4)
3. **localStorage that throws on write** (Safari private mode, blocked storage) — the popup must still close rather than crashing the page. (Task 4)
4. **Text exactly 500 characters, and 501** — the boundary the spec pins must accept one and reject the other. (Task 1)
5. **Text differing only in surrounding whitespace, and whitespace-only text** — the first must not re-show the popup, the second must mean off. (Task 1)

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/announcement-store.ts` (create) | Server store + validation: read/write `.cache/announcement.json`, compute the id, enforce the 500 limit |
| `app/api/bmstats/announcement/route.ts` (create) | Login-gated GET/POST |
| `app/api/announcement/route.ts` (create) | Public GET of `{ id, text }` |
| `lib/announcements.ts` (rewrite) | Client-only: last-seen id in localStorage |
| `components/AnnouncementPopup.tsx` (create) | The modal; replaces `AnnouncementBanner.tsx` |
| `components/BmStats.tsx` (modify) | New `AnnouncementEditor` card |
| `app/layout.tsx` (modify) | Mount the popup |
| `components/AnnouncementBanner.tsx` (delete) | Removed in Task 3, with its call site |
| `app/globals.css` (modify) | Drop the marquee block at 257-282 (Task 3); add a textarea rule if needed (Task 5) |
| `app/page.tsx` (modify) | Drop the banner call site and its imports (Task 3) |

---

## Task 1: Server store and validation

**Files:**
- Create: `lib/announcement-store.ts`
- Test: `__tests__/announcement-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const MAX_ANNOUNCEMENT = 500
  export interface Announcement { text: string; id: string; updatedAt: number }
  export function validateAnnouncement(text: unknown): { text: string } | { error: string }
  export class AnnouncementStore {
    constructor(file: string)
    read(): Announcement | null      // null = off
    write(text: string): Announcement | null
  }
  export function announcementStore(): AnnouncementStore   // singleton on .cache/announcement.json
  ```

Follow `lib/search-aliases-store.ts` throughout: class with an injected file path plus a module-level singleton, an mtime-keyed memo, atomic write via `<file>.<pid>.tmp` then `renameSync`, `memo = null` after a write, and `mkdirSync(dirname, { recursive: true })` before the first write.

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { AnnouncementStore, validateAnnouncement, MAX_ANNOUNCEMENT } from '@/lib/announcement-store'

let dir = ''
let file = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bat-ann-'))
  file = path.join(dir, '.cache', 'announcement.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const store = () => new AnnouncementStore(file)

describe('AnnouncementStore', () => {
  it('reads null when nothing has been written', () => {
    expect(store().read()).toBeNull()
  })

  it('round-trips the text', () => {
    const s = store()
    s.write('ประกาศใหม่')
    expect(s.read()?.text).toBe('ประกาศใหม่')
  })

  it('gives the same id for the same text and a different id for different text', () => {
    const a = store().write('same')!.id
    const b = store().write('same')!.id
    const c = store().write('other')!.id
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('trims, so text differing only in surrounding whitespace keeps its id', () => {
    const a = store().write('hello')!.id
    const s = store()
    expect(s.write('  hello\n')!.id).toBe(a)
    expect(s.read()?.text).toBe('hello')
  })

  it('treats whitespace-only text as off', () => {
    const s = store()
    s.write('something')
    expect(s.write('   \n ')).toBeNull()
    expect(s.read()).toBeNull()
  })

  it('reads null from malformed JSON instead of throwing', () => {
    store().write('x')
    writeFileSync(file, '{ not json', 'utf8')
    expect(store().read()).toBeNull()
  })

  it('sees a write made through another instance', () => {
    const reader = store()
    expect(reader.read()).toBeNull()
    store().write('later')
    expect(reader.read()?.text).toBe('later')
  })

  it('records updatedAt', () => {
    const before = Date.now()
    expect(store().write('x')!.updatedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('validateAnnouncement', () => {
  it('rejects non-strings', () => {
    expect(validateAnnouncement(7)).toEqual({ error: expect.any(String) })
    expect(validateAnnouncement(undefined)).toEqual({ error: expect.any(String) })
  })

  it('accepts the empty string, meaning off', () => {
    expect(validateAnnouncement('')).toEqual({ text: '' })
    expect(validateAnnouncement('   ')).toEqual({ text: '' })
  })

  it('accepts exactly the limit and rejects one over', () => {
    expect(validateAnnouncement('a'.repeat(MAX_ANNOUNCEMENT))).toEqual({ text: 'a'.repeat(MAX_ANNOUNCEMENT) })
    expect(validateAnnouncement('a'.repeat(MAX_ANNOUNCEMENT + 1))).toEqual({ error: expect.any(String) })
  })

  it('measures the limit after trimming', () => {
    expect(validateAnnouncement(`  ${'a'.repeat(MAX_ANNOUNCEMENT)}  `)).toEqual({ text: 'a'.repeat(MAX_ANNOUNCEMENT) })
  })

  it('allows & and | and newlines', () => {
    expect(validateAnnouncement('a & b | c\nd')).toEqual({ text: 'a & b | c\nd' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/announcement-store.test.ts`
Expected: FAIL — cannot resolve `@/lib/announcement-store`.

- [ ] **Step 3: Implement `lib/announcement-store.ts`**

The id is `crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex').slice(0, 12)`. `write('')` persists `{ version: 1, text: '', id: '', updatedAt: Date.now() }` and returns `null` — the file stays, the off state is recorded in it. `read()` returns `null` whenever the file is missing, unreadable, not `version: 1`, `text` is not a string, or `text.trim()` is empty. The singleton targets `path.join(process.cwd(), '.cache', 'announcement.json')`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/announcement-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/announcement-store.ts __tests__/announcement-store.test.ts
git commit -m "feat(announcement): add the server-side announcement store"
```

---

## Task 2: API routes

**Files:**
- Create: `app/api/bmstats/announcement/route.ts`
- Create: `app/api/announcement/route.ts`
- Test: `__tests__/api-announcement-routes.test.ts`

**Interfaces:**
- Consumes: `announcementStore()`, `validateAnnouncement`, `MAX_ANNOUNCEMENT` from Task 1; `isLoggedIn` from `lib/bmstats-auth`.
- Produces:
  - `GET /api/bmstats/announcement` → `200 { announcement: Announcement | null }`, `401 { error: 'login required' }`
  - `POST /api/bmstats/announcement` with `{ text }` → `200 { announcement: Announcement | null }`, `400 { error }`, `401 { error: 'login required' }`
  - `GET /api/announcement` → `200 { announcement: { id, text } | null }`

Copy the `NO_STORE` const and `denied()` helper shape from `app/api/bmstats/aliases/route.ts`, and log on change: `console.log('[bmstats] announcement set id=… len=…')`.

- [ ] **Step 1: Write the failing tests**

Follow `__tests__/bmstats-route.test.ts`: `process.chdir` into a temp dir, set `process.env.BMSTATS_PASSWORD`, log in through `@/app/api/bmstats/login/route` to get a real cookie.

```ts
import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'

const PW = 'ann-route-password'
let dir = ''
let cwd = ''
beforeAll(() => {
  cwd = process.cwd()
  dir = mkdtempSync(path.join(os.tmpdir(), 'bat-ann-route-'))
  process.chdir(dir)
  process.env.BMSTATS_PASSWORD = PW
})
afterAll(() => {
  process.chdir(cwd)
  delete process.env.BMSTATS_PASSWORD
  rmSync(dir, { recursive: true, force: true })
})

const admin = async (method: 'GET' | 'POST', cookie?: string, body?: unknown) => {
  const mod = await import('@/app/api/bmstats/announcement/route')
  const req = new Request('http://localhost/api/bmstats/announcement', {
    method,
    headers: cookie ? { cookie, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return method === 'GET' ? mod.GET(req) : mod.POST(req)
}
const publicGet = async () => (await import('@/app/api/announcement/route')).GET()
const login = async () => {
  const { POST } = await import('@/app/api/bmstats/login/route')
  const res = await POST(new Request('http://localhost/api/bmstats/login', {
    method: 'POST', body: JSON.stringify({ password: PW }),
  }))
  return (res.headers.get('set-cookie') ?? '').split(';')[0]
}

describe('/api/bmstats/announcement', () => {
  it('refuses GET and POST without a session', async () => {
    expect((await admin('GET')).status).toBe(401)
    const res = await admin('POST', undefined, { text: 'hi' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'login required' })
  })

  it('reports no announcement before anything is saved', async () => {
    expect(await (await admin('GET', await login())).json()).toEqual({ announcement: null })
  })

  it('saves and returns the new state', async () => {
    const res = await admin('POST', await login(), { text: 'ประกาศ' })
    expect(res.status).toBe(200)
    const { announcement } = await res.json()
    expect(announcement.text).toBe('ประกาศ')
    expect(announcement.id).toHaveLength(12)
  })

  it('rejects over-length and non-string text with a 400 and leaves the state alone', async () => {
    const cookie = await login()
    await admin('POST', cookie, { text: 'keep me' })
    expect((await admin('POST', cookie, { text: 'a'.repeat(501) })).status).toBe(400)
    expect((await admin('POST', cookie, { text: 7 })).status).toBe(400)
    expect((await (await admin('GET', cookie)).json()).announcement.text).toBe('keep me')
  })

  it('rejects a body that is not JSON with a 400', async () => {
    const cookie = await login()
    const mod = await import('@/app/api/bmstats/announcement/route')
    const res = await mod.POST(new Request('http://localhost/api/bmstats/announcement', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: 'not json',
    }))
    expect(res.status).toBe(400)
  })

  it('turns the popup off on an empty text', async () => {
    const cookie = await login()
    await admin('POST', cookie, { text: 'on' })
    expect(await (await admin('POST', cookie, { text: '' })).json()).toEqual({ announcement: null })
  })
})

describe('/api/announcement', () => {
  it('needs no session and reports null when off', async () => {
    expect(await (await publicGet()).json()).toEqual({ announcement: null })
  })

  it('serves the id and text, and not updatedAt', async () => {
    await admin('POST', await login(), { text: 'public text' })
    const { announcement } = await (await publicGet()).json()
    expect(announcement.text).toBe('public text')
    expect(announcement.id).toHaveLength(12)
    expect(announcement.updatedAt).toBeUndefined()
  })

  it('answers no-store', async () => {
    expect((await publicGet()).headers.get('cache-control')).toContain('no-store')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/api-announcement-routes.test.ts`
Expected: FAIL — the route modules do not resolve.

- [ ] **Step 3: Implement both routes**

The admin POST parses JSON in a try/catch (400 on failure), runs `validateAnnouncement`, writes, and answers with the store's current state. The public GET maps `read()` to `{ id, text }` or `null`.

Both route files sit in a temp cwd during tests, so the store singleton must resolve its path lazily — if Task 1's singleton memoized the path at module load, fix it there rather than working around it here.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/api-announcement-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/bmstats/announcement/route.ts app/api/announcement/route.ts __tests__/api-announcement-routes.test.ts
git commit -m "feat(announcement): add the admin and public announcement routes"
```

---

## Task 3: Client dismissal state

**Files:**
- Modify: `lib/announcements.ts` (replace its contents)
- Delete: `components/AnnouncementBanner.tsx`
- Modify: `app/page.tsx` (drop the call site at 1272-1276 and the imports at 23 and 30-31)
- Modify: `app/globals.css` (delete 257-282: `.announcement-marquee`, `.announcement-marquee__track`, the hover pause, `@keyframes announcement-marquee`, and the `prefers-reduced-motion` override)
- Test: `__tests__/announcements.test.ts` (replace its contents)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function lastSeenAnnouncement(): string | null
  export function markAnnouncementSeen(id: string): void
  ```

`ANN_CUSTOM_TABS_MULTI`, `ANN_CUSTOM_TABS_MULTI_TEXT_TH`, `isAnnouncementDismissed` and `dismissAnnouncement` are all deleted. Their only consumers are the banner and its call site, so this task removes those too and the marquee leaves with them — that keeps the commit building. Between this task and Task 4 the site simply shows no announcement, which is the state the feature ships in anyway.

- [ ] **Step 1: Write the failing tests**

```ts
/**
 * @jest-environment jsdom
 */
import { lastSeenAnnouncement, markAnnouncementSeen } from '@/lib/announcements'

beforeEach(() => localStorage.clear())

describe('announcement dismissal state', () => {
  it('reports nothing seen to start with', () => {
    expect(lastSeenAnnouncement()).toBeNull()
  })

  it('round-trips the last seen id', () => {
    markAnnouncementSeen('abc123')
    expect(lastSeenAnnouncement()).toBe('abc123')
  })

  it('keeps one key, replacing the previous id', () => {
    markAnnouncementSeen('first')
    markAnnouncementSeen('second')
    expect(lastSeenAnnouncement()).toBe('second')
    expect(Object.keys(localStorage).filter((k) => k.startsWith('batbracket.announcement'))).toEqual(
      ['batbracket.announcementSeen'],
    )
  })

  it('writes under batbracket.announcementSeen', () => {
    markAnnouncementSeen('xyz')
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('xyz')
  })

  it('survives storage that throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => markAnnouncementSeen('x')).not.toThrow()
    spy.mockRestore()
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(lastSeenAnnouncement()).toBeNull()
    get.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/announcements.test.ts`
Expected: FAIL — `lastSeenAnnouncement` is not exported.

- [ ] **Step 3: Rewrite `lib/announcements.ts`**

Both functions keep the existing `typeof window === 'undefined'` guard and try/catch, returning `null` / no-opping when storage is unavailable.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/announcements.test.ts`
Expected: PASS

- [ ] **Step 5: Remove the banner, its call site and the marquee CSS**

Delete `components/AnnouncementBanner.tsx`, the `<AnnouncementBanner …>` block and its two imports in `app/page.tsx`, and the marquee block in `app/globals.css`.

- [ ] **Step 6: Verify nothing references the old banner and the project builds**

Run: `grep -rn "AnnouncementBanner\|ANN_CUSTOM_TABS\|announcement-marquee\|isAnnouncementDismissed\|dismissAnnouncement" app components lib __tests__`
Expected: no matches.

Run: `npx tsc --noEmit && npm run lint && npx jest`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/announcements.ts __tests__/announcements.test.ts app/page.tsx app/globals.css
git rm components/AnnouncementBanner.tsx
git commit -m "refactor(announcement): drop the marquee banner and track one last-seen id"
```

---

## Task 4: The popup

**Files:**
- Create: `components/AnnouncementPopup.tsx`
- Modify: `app/layout.tsx` (mount beside `SearchAliasesLoader`, around line 55)
- Test: `__tests__/AnnouncementPopup.test.tsx`

**Interfaces:**
- Consumes: `lastSeenAnnouncement`, `markAnnouncementSeen` from Task 3; `GET /api/announcement` from Task 2; `track` from `lib/analytics`.
- Produces: `export default function AnnouncementPopup(): JSX.Element | null` — no props.

Markup follows `components/CustomTabModal.tsx`: `.pm-overlay` (click closes) wrapping `.pm-modal` (`onClick` `stopPropagation`, `style={{ maxWidth: 420 }}`) with `role="dialog"`, `aria-modal="true"`, an `aria-label`, a `.pm-close` ✕, Escape via a `useEffect` keydown listener on `document`, and focus moved to the OK button through a zero-delay `setTimeout`. The text renders in a `<div className="whitespace-pre-wrap">`. Suppress the popup under `/bmstats` via `usePathname()`. Every close path — OK, ✕, Escape, backdrop — calls the same handler: `markAnnouncementSeen(id)`, `track('announcement_dismissed', { id })`, then hide.

- [ ] **Step 1: Write the failing tests**

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AnnouncementPopup from '@/components/AnnouncementPopup'

let pathname = '/'
jest.mock('next/navigation', () => ({ usePathname: () => pathname }))
const track = jest.fn()
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }))

const serve = (announcement: unknown, ok = true) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok, json: async () => ({ announcement }),
  }) as unknown as typeof fetch
}

beforeEach(() => {
  pathname = '/'
  localStorage.clear()
  track.mockClear()
})

describe('AnnouncementPopup', () => {
  it('shows the text and an OK button when nothing has been seen', async () => {
    serve({ id: 'aaa', text: 'ประกาศใหม่' })
    render(<AnnouncementPopup />)
    expect(await screen.findByText('ประกาศใหม่')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument()
  })

  it('stores the id and reports the dismissal when OK is clicked', async () => {
    serve({ id: 'aaa', text: 'hello' })
    render(<AnnouncementPopup />)
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }))
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('aaa')
    expect(track).toHaveBeenCalledWith('announcement_dismissed', { id: 'aaa' })
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('stays away for an id already seen', async () => {
    localStorage.setItem('batbracket.announcementSeen', 'aaa')
    serve({ id: 'aaa', text: 'hello' })
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('shows again once the id changes', async () => {
    localStorage.setItem('batbracket.announcementSeen', 'aaa')
    serve({ id: 'bbb', text: 'new text' })
    render(<AnnouncementPopup />)
    expect(await screen.findByText('new text')).toBeInTheDocument()
  })

  it('shows nothing when the announcement is off', async () => {
    serve(null)
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // Review Focus 2
  it('shows nothing when the fetch fails or the body is unusable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    const { unmount } = render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()

    serve({ id: 'aaa', text: 'nope' }, false)
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // Review Focus 1
  it('renders markup in the text as literal characters', async () => {
    serve({ id: 'aaa', text: '<script>alert(1)</script> & <b>bold</b>' })
    render(<AnnouncementPopup />)
    expect(await screen.findByText('<script>alert(1)</script> & <b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
  })

  it('keeps line breaks from the textarea', async () => {
    serve({ id: 'aaa', text: 'line one\nline two' })
    render(<AnnouncementPopup />)
    const el = await screen.findByText(/line one/)
    expect(el).toHaveClass('whitespace-pre-wrap')
  })

  it('treats Escape and a backdrop click as OK', async () => {
    serve({ id: 'aaa', text: 'hello' })
    const { unmount } = render(<AnnouncementPopup />)
    await screen.findByText('hello')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('aaa')
    unmount()

    localStorage.clear()
    serve({ id: 'bbb', text: 'again' })
    render(<AnnouncementPopup />)
    await screen.findByText('again')
    fireEvent.click(document.querySelector('.pm-overlay')!)
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('bbb')
  })

  // Review Focus 3
  it('still closes when storage refuses the write', async () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    serve({ id: 'aaa', text: 'hello' })
    render(<AnnouncementPopup />)
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }))
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('never appears on /bmstats', async () => {
    pathname = '/bmstats'
    serve({ id: 'aaa', text: 'hello' })
    render(<AnnouncementPopup />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/AnnouncementPopup.test.tsx`
Expected: FAIL — cannot resolve `@/components/AnnouncementPopup`.

- [ ] **Step 3: Implement `components/AnnouncementPopup.tsx`**

`'use client'`. One `useEffect` on mount: return early when `usePathname()` starts with `/bmstats`, read `lastSeenAnnouncement()`, `fetch('/api/announcement', { cache: 'no-store' })`, and set state only when the response is ok, carries an announcement with a string `text` and a string `id`, and that id differs from the stored one. Guard against setting state after unmount with a `cancelled` flag, as `SearchAliasesLoader` does. Wrap the close handler's `markAnnouncementSeen` so a throwing storage cannot stop the hide.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/AnnouncementPopup.test.tsx`
Expected: PASS

- [ ] **Step 5: Mount it in the root layout**

Add `<AnnouncementPopup />` beside `<SearchAliasesLoader />` in `app/layout.tsx`, so the announcement reaches every route.

- [ ] **Step 6: Verify the project builds**

Run: `npx tsc --noEmit && npm run lint && npx jest`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add components/AnnouncementPopup.tsx __tests__/AnnouncementPopup.test.tsx app/layout.tsx
git commit -m "feat(announcement): show the announcement as a one-time popup"
```

---

## Task 5: The editor on /bmstats

**Files:**
- Modify: `components/BmStats.tsx` (add `AnnouncementEditor`, render it in the card list beside `<AliasEditor />` at the end of the component)
- Modify: `app/globals.css` (add a `bms-announcement-textarea` rule beside the other `bms-*` rules if `bms-login-input` does not suit a textarea)
- Test: `__tests__/AnnouncementEditor.test.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/bmstats/announcement` from Task 2.
- Produces: nothing other tasks use. Export `AnnouncementEditor` from `components/BmStats.tsx` so the test can mount it alone.

Shaped like `AliasEditor` in the same file: a `<Card title="Announcement">`, one `error` string, one `busy` flag, a single `apply(res)` helper that reads `{ announcement, error }` and updates state, and the `bms-note` / `bms-login-input` / `bms-login-button` / `bms-login-error` classes. The status line reads **On**, with the last-updated time formatted the way the rest of `BmStats.tsx` formats times, or **Off**. Save is disabled while busy or while the textarea matches the loaded text; Clear is disabled while busy or already off.

- [ ] **Step 1: Write the failing tests**

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AnnouncementEditor } from '@/components/BmStats'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })

describe('AnnouncementEditor', () => {
  it('loads the current text into the textarea and reports it on', async () => {
    fetchMock.mockResolvedValue(reply({ announcement: { text: 'current', id: 'aaa', updatedAt: Date.now() } }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('current'))
    expect(screen.getByText(/on/i)).toBeInTheDocument()
  })

  it('reports off when there is no announcement', async () => {
    fetchMock.mockResolvedValue(reply({ announcement: null }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByText(/off/i)).toBeInTheDocument())
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('posts the typed text on Save', async () => {
    fetchMock.mockResolvedValueOnce(reply({ announcement: null }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
    fetchMock.mockResolvedValueOnce(reply({ announcement: { text: 'typed', id: 'bbb', updatedAt: Date.now() } }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typed' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/bmstats/announcement')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ text: 'typed' })
  })

  it('posts an empty text on Clear and reports off', async () => {
    fetchMock.mockResolvedValueOnce(reply({ announcement: { text: 'on now', id: 'aaa', updatedAt: Date.now() } }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('on now'))
    fetchMock.mockResolvedValueOnce(reply({ announcement: null }))
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ text: '' })
    await waitFor(() => expect(screen.getByText(/off/i)).toBeInTheDocument())
  })

  it('shows the server error and keeps the typed text', async () => {
    fetchMock.mockResolvedValueOnce(reply({ announcement: null }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
    fetchMock.mockResolvedValueOnce(reply({ error: 'The announcement can be at most 500 characters.' }, false, 400))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'too long' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 500/)
    expect(screen.getByRole('textbox')).toHaveValue('too long')
  })

  it('shows a message when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<AnnouncementEditor />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('disables Save until the text changes', async () => {
    fetchMock.mockResolvedValue(reply({ announcement: { text: 'same', id: 'aaa', updatedAt: Date.now() } }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('same'))
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'same!' } })
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/AnnouncementEditor.test.tsx`
Expected: FAIL — `AnnouncementEditor` is not exported from `components/BmStats.tsx`.

- [ ] **Step 3: Implement `AnnouncementEditor` in `components/BmStats.tsx` and render it**

Export it by name alongside the existing `BmStatsThemeToggle` export. The `bms-note` tells the owner, in English: the text pops up once for each visitor, changing it shows it again to everyone, an empty box turns it off, and visitors see the change on their next page load. Include a character counter against the 500 limit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/AnnouncementEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the whole suite and the build**

Run: `npx tsc --noEmit && npm run lint && npx jest`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/BmStats.tsx app/globals.css __tests__/AnnouncementEditor.test.tsx
git commit -m "feat(bmstats): add the announcement editor card"
```

---

## Manual Verification

After Task 5, against `npm run dev`:

- [ ] `/bmstats`, logged in: the Announcement card loads and reads **Off**.
- [ ] Save text → reload `/` → the popup appears with that text, line breaks intact.
- [ ] OK → gone. Reload → still gone.
- [ ] Change the text on `/bmstats` → reload `/` → it appears again, without clearing localStorage.
- [ ] Save the same text again → reload → no popup.
- [ ] Clear the box → the card reads **Off** → reload → no popup.
- [ ] Escape, and a backdrop click, each stick across a reload.
- [ ] No popup on `/bmstats` itself.
- [ ] It does appear on `/leaderboards` and on a player page.
- [ ] Legible in both light and dark themes, and at mobile width.
