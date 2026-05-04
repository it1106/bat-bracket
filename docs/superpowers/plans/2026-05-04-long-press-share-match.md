# Long-press Share Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long-press on a `.ms-match` row on mobile captures the row as a branded JPEG and opens the system share sheet.

**Architecture:** A reusable React hook (`useLongPressShare`) attaches **delegated** touch listeners to a container element and fires when a long-press lands on any descendant matching a CSS selector. A capture utility (`shareMatchAsImage`) clones the row off-screen, strips highlight classes, injects a branded header, renders to JPEG via `html-to-image`, then opens `navigator.share` (or falls back to download). `MatchSchedule.tsx` calls the hook once at the component top level (delegation avoids per-row hook calls, which would break Rules of Hooks when the visible match count changes).

**Tech Stack:** React 18, TypeScript, `html-to-image` (already a dependency), Web Share API, Jest + jsdom + `@testing-library/react`.

**Spec:** [`docs/superpowers/specs/2026-05-04-long-press-share-match-design.md`](../specs/2026-05-04-long-press-share-match-design.md)

---

## File Structure

| File | Purpose |
| --- | --- |
| `lib/useLongPressShare.ts` (new) | React hook: delegated long-press detection on a container, press-feedback class, click suppression |
| `lib/shareMatchAsImage.ts` (new) | Pure async function: clone row → header → JPEG → share/download |
| `app/globals.css` (modify) | `.ms-match--pressing` scale animation, `user-select: none` on `.ms-match` |
| `components/MatchSchedule.tsx` (modify) | Add `tournamentName` prop, container ref, match-key map, hook wiring, `data-match-key` attribute |
| `app/page.tsx` (modify) | Pass `tournamentName` to all three `<MatchSchedule>` instances |
| `__tests__/useLongPressShare.test.tsx` (new) | Hook unit tests |
| `__tests__/shareMatchAsImage.test.ts` (new) | Capture + share unit tests |

---

## Task 1: `useLongPressShare` — basic hold-and-fire (delegated)

**Files:**
- Create: `lib/useLongPressShare.ts`
- Test: `__tests__/useLongPressShare.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/useLongPressShare.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { useLongPressShare } from '@/lib/useLongPressShare'

function makeTouch(target: Element, clientY = 100): Touch {
  return { identifier: 0, target, clientX: 0, clientY, pageX: 0, pageY: 0, screenX: 0, screenY: 0, radiusX: 0, radiusY: 0, rotationAngle: 0, force: 0 } as Touch
}

function fireTouch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', clientY = 100) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [makeTouch(target, clientY)] })
  Object.defineProperty(ev, 'changedTouches', { value: [makeTouch(target, clientY)] })
  Object.defineProperty(ev, 'target', { value: target, configurable: true })
  target.dispatchEvent(ev)
}

function Harness({ onFire }: { onFire: (el: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLongPressShare(ref, { matchSelector: '.row', onFire, holdMs: 500 })
  return (
    <div ref={ref} data-testid="container">
      <div className="row" data-testid="row1" />
      <div className="row" data-testid="row2" />
      <div data-testid="not-a-row" />
    </div>
  )
}

describe('useLongPressShare', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('fires onFire with the matched element after holdMs', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    expect(onFire).not.toHaveBeenCalled()
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith(row1)
  })

  it('does not fire when touchstart hits a non-matching descendant', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const notRow = getByTestId('not-a-row')
    act(() => { fireTouch(notRow, 'touchstart') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/useLongPressShare.test.tsx`
Expected: FAIL — "Cannot find module '@/lib/useLongPressShare'".

- [ ] **Step 3: Write minimal implementation**

Create `lib/useLongPressShare.ts`:

```ts
'use client'

import { useEffect, type RefObject } from 'react'

interface UseLongPressShareOptions {
  matchSelector: string
  onFire: (matchEl: HTMLElement) => void
  holdMs?: number
  moveSlopPx?: number
  pressClass?: string
}

export function useLongPressShare(
  containerRef: RefObject<HTMLElement>,
  options: UseLongPressShareOptions,
): void {
  const { matchSelector, onFire, holdMs = 500 } = options

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let activeMatch: HTMLElement | null = null

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (!match || !container.contains(match)) return
      activeMatch = match
      timer = setTimeout(() => {
        timer = null
        const fired = activeMatch
        activeMatch = null
        if (fired) onFire(fired)
      }, holdMs)
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      if (timer) clearTimeout(timer)
    }
  }, [containerRef, matchSelector, onFire, holdMs])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/useLongPressShare.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/useLongPressShare.ts __tests__/useLongPressShare.test.tsx
git commit -m "feat(share): add useLongPressShare hook — delegated hold-and-fire"
```

---

## Task 2: `useLongPressShare` — cancel paths + press class

**Files:**
- Modify: `lib/useLongPressShare.ts`
- Modify: `__tests__/useLongPressShare.test.tsx`

- [ ] **Step 1: Add failing tests for cancellation**

Append inside the `describe` block in `__tests__/useLongPressShare.test.tsx`:

```tsx
  it('does not fire when touch ends before holdMs', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    act(() => { jest.advanceTimersByTime(300) })
    act(() => { fireTouch(row1, 'touchend') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('does not fire when touch moves more than slop', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart', 100) })
    act(() => { fireTouch(row1, 'touchmove', 130) })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('does not fire on touchcancel', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    act(() => { fireTouch(row1, 'touchcancel') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('toggles pressClass on the matched element during the hold', () => {
    const { getByTestId } = render(<Harness onFire={() => {}} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    expect(row1.classList.contains('ms-match--pressing')).toBe(true)
    act(() => { fireTouch(row1, 'touchend') })
    expect(row1.classList.contains('ms-match--pressing')).toBe(false)
  })

  it('cleans up timer and listeners on unmount', () => {
    const onFire = jest.fn()
    const { getByTestId, unmount } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    unmount()
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npx jest __tests__/useLongPressShare.test.tsx`
Expected: FAIL on the five new tests; the original two still pass.

- [ ] **Step 3: Replace `lib/useLongPressShare.ts`**

```ts
'use client'

import { useEffect, type RefObject } from 'react'

interface UseLongPressShareOptions {
  matchSelector: string
  onFire: (matchEl: HTMLElement) => void
  holdMs?: number
  moveSlopPx?: number
  pressClass?: string
}

export function useLongPressShare(
  containerRef: RefObject<HTMLElement>,
  options: UseLongPressShareOptions,
): void {
  const { matchSelector, onFire, holdMs = 500, moveSlopPx = 10, pressClass = 'ms-match--pressing' } = options

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let activeMatch: HTMLElement | null = null
    let startY = 0

    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (activeMatch) { activeMatch.classList.remove(pressClass); activeMatch = null }
    }

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (!match || !container.contains(match)) return
      const t = e.touches[0]
      if (!t) return
      activeMatch = match
      startY = t.clientY
      match.classList.add(pressClass)
      timer = setTimeout(() => {
        timer = null
        const fired = activeMatch
        if (fired) {
          fired.classList.remove(pressClass)
          activeMatch = null
          onFire(fired)
        }
      }, holdMs)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!activeMatch) return
      const t = e.touches[0]
      if (!t) return
      if (Math.abs(t.clientY - startY) > moveSlopPx) cancel()
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: true })
    container.addEventListener('touchend', cancel)
    container.addEventListener('touchcancel', cancel)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', cancel)
      container.removeEventListener('touchcancel', cancel)
      if (timer) clearTimeout(timer)
      if (activeMatch) activeMatch.classList.remove(pressClass)
    }
  }, [containerRef, matchSelector, onFire, holdMs, moveSlopPx, pressClass])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/useLongPressShare.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/useLongPressShare.ts __tests__/useLongPressShare.test.tsx
git commit -m "feat(share): cancel long-press on early release, move, touchcancel, unmount"
```

---

## Task 3: `useLongPressShare` — click suppression, contextmenu, vibrate

**Files:**
- Modify: `lib/useLongPressShare.ts`
- Modify: `__tests__/useLongPressShare.test.tsx`

- [ ] **Step 1: Add failing tests**

Append inside the `describe` block:

```tsx
  it('suppresses the next click after firing', () => {
    const onFire = jest.fn()
    const onRowClick = jest.fn()
    function H() {
      const ref = useRef<HTMLDivElement>(null)
      useLongPressShare(ref, { matchSelector: '.row', onFire })
      return (
        <div ref={ref}>
          <div className="row" data-testid="row1" onClick={onRowClick} />
        </div>
      )
    }
    const { getByTestId } = render(<H />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).toHaveBeenCalledTimes(1)
    act(() => { row1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(onRowClick).not.toHaveBeenCalled()
    act(() => { row1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it('prevents the contextmenu event on a matched element', () => {
    const { getByTestId } = render(<Harness onFire={() => {}} />)
    const row1 = getByTestId('row1')
    const ev = new Event('contextmenu', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'target', { value: row1, configurable: true })
    row1.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('calls navigator.vibrate when firing', () => {
    const vibrate = jest.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    const { getByTestId } = render(<Harness onFire={() => {}} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(vibrate).toHaveBeenCalledWith(15)
  })
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npx jest __tests__/useLongPressShare.test.tsx`
Expected: FAIL on the three new tests.

- [ ] **Step 3: Replace `lib/useLongPressShare.ts`**

```ts
'use client'

import { useEffect, type RefObject } from 'react'

interface UseLongPressShareOptions {
  matchSelector: string
  onFire: (matchEl: HTMLElement) => void
  holdMs?: number
  moveSlopPx?: number
  pressClass?: string
}

export function useLongPressShare(
  containerRef: RefObject<HTMLElement>,
  options: UseLongPressShareOptions,
): void {
  const { matchSelector, onFire, holdMs = 500, moveSlopPx = 10, pressClass = 'ms-match--pressing' } = options

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let activeMatch: HTMLElement | null = null
    let startY = 0
    let suppressClickFor: HTMLElement | null = null

    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (activeMatch) { activeMatch.classList.remove(pressClass); activeMatch = null }
    }

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (!match || !container.contains(match)) return
      const t = e.touches[0]
      if (!t) return
      activeMatch = match
      startY = t.clientY
      match.classList.add(pressClass)
      timer = setTimeout(() => {
        timer = null
        const fired = activeMatch
        if (fired) {
          fired.classList.remove(pressClass)
          activeMatch = null
          suppressClickFor = fired
          navigator.vibrate?.(15)
          onFire(fired)
        }
      }, holdMs)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!activeMatch) return
      const t = e.touches[0]
      if (!t) return
      if (Math.abs(t.clientY - startY) > moveSlopPx) cancel()
    }

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickFor) return
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (match === suppressClickFor) {
        e.stopPropagation()
        e.preventDefault()
        suppressClickFor = null
      }
    }

    const onContextMenu = (e: Event) => {
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (match && container.contains(match)) e.preventDefault()
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: true })
    container.addEventListener('touchend', cancel)
    container.addEventListener('touchcancel', cancel)
    container.addEventListener('click', onClickCapture, true)
    container.addEventListener('contextmenu', onContextMenu)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', cancel)
      container.removeEventListener('touchcancel', cancel)
      container.removeEventListener('click', onClickCapture, true)
      container.removeEventListener('contextmenu', onContextMenu)
      if (timer) clearTimeout(timer)
      if (activeMatch) activeMatch.classList.remove(pressClass)
    }
  }, [containerRef, matchSelector, onFire, holdMs, moveSlopPx, pressClass])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/useLongPressShare.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/useLongPressShare.ts __tests__/useLongPressShare.test.tsx
git commit -m "feat(share): suppress click after long-press, prevent contextmenu, haptic"
```

---

## Task 4: `shareMatchAsImage` — capture pipeline

**Files:**
- Create: `lib/shareMatchAsImage.ts`
- Test: `__tests__/shareMatchAsImage.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/shareMatchAsImage.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { shareMatchAsImage } from '@/lib/shareMatchAsImage'

jest.mock('html-to-image', () => ({
  toJpeg: jest.fn(async () => 'data:image/jpeg;base64,AAAA'),
}))

import { toJpeg } from 'html-to-image'

function makeRow(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'ms-match ms-match--active ms-match--next-opp'
  el.innerHTML = `
    <div class="ms-meta"><span class="ms-event">WS</span></div>
    <div class="ms-team ms-team--1"><span class="ms-player-highlight">Alpha</span></div>
    <div class="ms-score">21-15</div>
    <div class="ms-team ms-team--2"><span>Beta</span></div>
  `
  return el
}

beforeEach(() => {
  ;(toJpeg as jest.Mock).mockClear()
  ;(toJpeg as jest.Mock).mockResolvedValue('data:image/jpeg;base64,AAAA')
  document.body.innerHTML = ''
  document.documentElement.classList.remove('dark')
  ;(global as { fetch: unknown }).fetch = jest.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/jpeg' }) }))
  Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true })
  Object.defineProperty(navigator, 'share', { value: jest.fn(), configurable: true })
  if (typeof global.requestAnimationFrame !== 'function') {
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame
  }
})

describe('shareMatchAsImage', () => {
  it('renders to JPEG via toJpeg with the wrapper element', async () => {
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'BAT Open', eventName: 'WS U19' })
    expect(toJpeg).toHaveBeenCalledTimes(1)
    const arg = (toJpeg as jest.Mock).mock.calls[0][0] as HTMLElement
    expect(arg).toBeInstanceOf(HTMLElement)
    expect(arg.querySelector('.ms-match')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/shareMatchAsImage.test.ts`
Expected: FAIL — "Cannot find module '@/lib/shareMatchAsImage'".

- [ ] **Step 3: Implement `lib/shareMatchAsImage.ts`**

```ts
'use client'

import { toJpeg } from 'html-to-image'

interface ShareMatchOptions {
  matchEl: HTMLElement
  tournamentName: string
  eventName: string
}

const HIGHLIGHT_CLASSES = ['ms-match--active', 'ms-match--next-opp', 'ms-match--tracked', 'ms-match--pressing']

function formatDate(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function buildHeader(tournamentName: string, eventName: string): HTMLElement {
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 14px 14px 10px 14px;
    border-bottom: 2px solid #dee2e6;
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: white;
  `
  header.innerHTML = `
    <div style="font-size:16px;font-weight:700;margin-bottom:2px;">
      <span style="color:#25316B;">BAT</span> <span style="color:#BE1D2E;">Unofficial</span> Scores
    </div>
    <div style="font-size:10px;color:#888;margin-bottom:6px;">Check BAT official website for accuracy</div>
    <div style="font-size:13px;font-weight:600;color:#333;margin-bottom:2px;">${tournamentName}</div>
    <div style="font-size:12px;color:#555;margin-bottom:4px;">${eventName}</div>
    <div style="font-size:10px;color:#999;">Exported: ${formatDate(new Date())}</div>
  `
  return header
}

function cleanClone(matchEl: HTMLElement): HTMLElement {
  const clone = matchEl.cloneNode(true) as HTMLElement
  for (const cls of HIGHLIGHT_CLASSES) clone.classList.remove(cls)
  clone.querySelectorAll('.ms-player-highlight').forEach((el) => el.classList.remove('ms-player-highlight'))
  return clone
}

export async function shareMatchAsImage(opts: ShareMatchOptions): Promise<void> {
  const { matchEl, tournamentName, eventName } = opts

  const root = document.documentElement
  const hadDark = root.classList.contains('dark')
  if (hadDark) root.classList.remove('dark')

  const wrapper = document.createElement('div')
  wrapper.style.cssText = `
    position: fixed; left: -9999px; top: 0; width: 380px;
    background: #ffffff; font-family: 'Segoe UI', system-ui, sans-serif;
  `
  wrapper.appendChild(buildHeader(tournamentName, eventName))
  wrapper.appendChild(cleanClone(matchEl))
  document.body.appendChild(wrapper)

  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

  try {
    await toJpeg(wrapper, { quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff' })
  } catch (err) {
    console.warn('shareMatchAsImage: capture failed', err)
  } finally {
    document.body.removeChild(wrapper)
    if (hadDark) root.classList.add('dark')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/shareMatchAsImage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/shareMatchAsImage.ts __tests__/shareMatchAsImage.test.ts
git commit -m "feat(share): capture cloned match row to JPEG with branded header"
```

---

## Task 5: `shareMatchAsImage` — state isolation tests

**Files:**
- Modify: `__tests__/shareMatchAsImage.test.ts`

- [ ] **Step 1: Add tests locking in state-isolation behaviour**

Append inside the `describe` block:

```ts
  it('strips highlight classes from the cloned row but not the original', async () => {
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(row.classList.contains('ms-match--active')).toBe(true)
    expect(row.classList.contains('ms-match--next-opp')).toBe(true)
    expect(row.querySelector('.ms-player-highlight')).not.toBeNull()
    const captured = (toJpeg as jest.Mock).mock.calls[0][0] as HTMLElement
    const cloned = captured.querySelector('.ms-match') as HTMLElement
    expect(cloned.classList.contains('ms-match--active')).toBe(false)
    expect(cloned.classList.contains('ms-match--next-opp')).toBe(false)
    expect(cloned.querySelector('.ms-player-highlight')).toBeNull()
  })

  it('forces light mode during capture and restores dark afterwards', async () => {
    document.documentElement.classList.add('dark')
    const row = makeRow()
    document.body.appendChild(row)
    let darkDuringCapture: boolean | null = null
    ;(toJpeg as jest.Mock).mockImplementation(async () => {
      darkDuringCapture = document.documentElement.classList.contains('dark')
      return 'data:image/jpeg;base64,AAAA'
    })
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(darkDuringCapture).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the wrapper from document.body after capture', async () => {
    const row = makeRow()
    document.body.appendChild(row)
    const before = document.body.children.length
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(document.body.children.length).toBe(before)
  })

  it('removes the wrapper even when toJpeg throws', async () => {
    ;(toJpeg as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    const row = makeRow()
    document.body.appendChild(row)
    const before = document.body.children.length
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(document.body.children.length).toBe(before)
  })
```

- [ ] **Step 2: Run tests**

Run: `npx jest __tests__/shareMatchAsImage.test.ts`
Expected: PASS — these tests lock in behaviour already implemented in Task 4.

- [ ] **Step 3: Commit**

```bash
git add __tests__/shareMatchAsImage.test.ts
git commit -m "test(share): lock state-isolation behaviour for shareMatchAsImage"
```

---

## Task 6: `shareMatchAsImage` — Web Share with download fallback

**Files:**
- Modify: `lib/shareMatchAsImage.ts`
- Modify: `__tests__/shareMatchAsImage.test.ts`

- [ ] **Step 1: Add failing tests for share / download / abort**

Append inside the `describe` block:

```ts
  it('calls navigator.share when canShare returns true', async () => {
    const share = jest.fn(async () => {})
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(share).toHaveBeenCalledTimes(1)
    const arg = share.mock.calls[0][0] as { files: File[] }
    expect(arg.files[0]).toBeInstanceOf(File)
    expect(arg.files[0].type).toBe('image/jpeg')
  })

  it('falls back to download when canShare returns false', async () => {
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'BAT Open', eventName: 'WS U19' })
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('swallows AbortError from navigator.share', async () => {
    const abort = new Error('cancelled') as Error & { name: string }
    abort.name = 'AbortError'
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: jest.fn(async () => { throw abort }), configurable: true })
    const row = makeRow()
    document.body.appendChild(row)
    await expect(
      shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' }),
    ).resolves.toBeUndefined()
  })

  it('falls back to download when navigator.share rejects with non-Abort', async () => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: jest.fn(async () => { throw new Error('nope') }), configurable: true })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npx jest __tests__/shareMatchAsImage.test.ts`
Expected: FAIL on the four new tests.

- [ ] **Step 3: Replace `lib/shareMatchAsImage.ts`**

```ts
'use client'

import { toJpeg } from 'html-to-image'

interface ShareMatchOptions {
  matchEl: HTMLElement
  tournamentName: string
  eventName: string
}

const HIGHLIGHT_CLASSES = ['ms-match--active', 'ms-match--next-opp', 'ms-match--tracked', 'ms-match--pressing']
const FILENAME_MAX = 80

function buildSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function buildHeader(tournamentName: string, eventName: string): HTMLElement {
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 14px 14px 10px 14px;
    border-bottom: 2px solid #dee2e6;
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: white;
  `
  header.innerHTML = `
    <div style="font-size:16px;font-weight:700;margin-bottom:2px;">
      <span style="color:#25316B;">BAT</span> <span style="color:#BE1D2E;">Unofficial</span> Scores
    </div>
    <div style="font-size:10px;color:#888;margin-bottom:6px;">Check BAT official website for accuracy</div>
    <div style="font-size:13px;font-weight:600;color:#333;margin-bottom:2px;">${tournamentName}</div>
    <div style="font-size:12px;color:#555;margin-bottom:4px;">${eventName}</div>
    <div style="font-size:10px;color:#999;">Exported: ${formatDate(new Date())}</div>
  `
  return header
}

function cleanClone(matchEl: HTMLElement): HTMLElement {
  const clone = matchEl.cloneNode(true) as HTMLElement
  for (const cls of HIGHLIGHT_CLASSES) clone.classList.remove(cls)
  clone.querySelectorAll('.ms-player-highlight').forEach((el) => el.classList.remove('ms-player-highlight'))
  return clone
}

function buildFilename(tournamentName: string, eventName: string): string {
  const base = `${buildSlug(tournamentName)}-${buildSlug(eventName)}-${Date.now()}.jpg`
  return base.length > FILENAME_MAX ? base.slice(0, FILENAME_MAX - 4) + '.jpg' : base
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], filename, { type: 'image/jpeg' })
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

export async function shareMatchAsImage(opts: ShareMatchOptions): Promise<void> {
  const { matchEl, tournamentName, eventName } = opts

  const root = document.documentElement
  const hadDark = root.classList.contains('dark')
  if (hadDark) root.classList.remove('dark')

  const wrapper = document.createElement('div')
  wrapper.style.cssText = `
    position: fixed; left: -9999px; top: 0; width: 380px;
    background: #ffffff; font-family: 'Segoe UI', system-ui, sans-serif;
  `
  wrapper.appendChild(buildHeader(tournamentName, eventName))
  wrapper.appendChild(cleanClone(matchEl))
  document.body.appendChild(wrapper)

  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

  let dataUrl: string | null = null
  try {
    dataUrl = await toJpeg(wrapper, { quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff' })
  } catch (err) {
    console.warn('shareMatchAsImage: capture failed', err)
  } finally {
    document.body.removeChild(wrapper)
    if (hadDark) root.classList.add('dark')
  }

  if (!dataUrl) return

  const filename = buildFilename(tournamentName, eventName)
  const file = await dataUrlToFile(dataUrl, filename)
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

  if (canShare) {
    try {
      await navigator.share({ files: [file], title: tournamentName, text: `${tournamentName} — ${eventName}` })
      return
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
    }
  }

  downloadDataUrl(dataUrl, filename)
}
```

- [ ] **Step 4: Run all share tests**

Run: `npx jest __tests__/shareMatchAsImage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/shareMatchAsImage.ts __tests__/shareMatchAsImage.test.ts
git commit -m "feat(share): open Web Share sheet with JPEG, fall back to download"
```

---

## Task 7: CSS — press feedback animation

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Update the `.ms-match` block and add the new selectors**

Find the existing `.ms-match` block in `app/globals.css` (around line 1218) and append four properties to it. Then add `.ms-match--pressing` and the reduced-motion media query immediately after `.ms-match:hover { background: var(--bg); }` (around line 1229).

Replace:

```css
.ms-match {
  display: grid;
  grid-template-columns: 150px 250px 250px 250px;
  grid-template-areas: "meta team1 score team2";
  align-items: normal;
  padding: 8px 12px;
  border-bottom: 1px solid var(--row-sep);
  color: var(--fg);
}

.ms-match:last-child { border-bottom: none; }
.ms-match:hover { background: var(--bg); }
```

with:

```css
.ms-match {
  display: grid;
  grid-template-columns: 150px 250px 250px 250px;
  grid-template-areas: "meta team1 score team2";
  align-items: normal;
  padding: 8px 12px;
  border-bottom: 1px solid var(--row-sep);
  color: var(--fg);
  transition: transform 180ms ease-out;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

.ms-match:last-child { border-bottom: none; }
.ms-match:hover { background: var(--bg); }

.ms-match--pressing {
  transform: scale(0.98);
  transition: transform 480ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .ms-match--pressing { transform: none; }
}
```

- [ ] **Step 2: Verify CSS lints**

Run: `npx next lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(share): add .ms-match--pressing scale animation for long-press feedback"
```

---

## Task 8: Wire delegation hook + capture into MatchSchedule

**Files:**
- Modify: `components/MatchSchedule.tsx`

- [ ] **Step 1: Add `tournamentName` to Props**

In `components/MatchSchedule.tsx`, edit the `Props` interface (around line 14) — add `tournamentName?: string` at the end:

```ts
interface Props {
  groups: MatchScheduleGroup[]
  days: MatchDay[]
  selectedDay: string
  onDayChange: (date: string) => void
  loading: boolean
  playerQuery: string
  excludeCompleted?: boolean
  highlightMatches?: boolean
  showJumpToNext?: boolean
  onEventClick?: (drawNum: string, round: string) => void
  playerClubMap?: Record<string, string>
  onPlayerClick?: (playerId: string) => void
  onH2HClick?: (h2hUrl: string, m: MatchEntry) => void
  liveByCourt?: Map<string, CourtLive>
  tournamentId?: string
  tournamentName?: string
}
```

Add `tournamentName` to the destructured props (around line 98):

```ts
export default function MatchSchedule({ groups, days, selectedDay, onDayChange, loading, playerQuery, excludeCompleted = false, highlightMatches = true, showJumpToNext = true, onEventClick, playerClubMap, onPlayerClick, onH2HClick, liveByCourt, tournamentId, tournamentName }: Props) {
```

- [ ] **Step 2: Add imports**

Replace the existing import line for hooks/contexts at the top of the file:

```ts
import { useMemo, useRef, useState, useEffect } from 'react'
```

(unchanged — just confirm `useRef` is in there.)

Add new imports near the top:

```ts
import { useLongPressShare } from '@/lib/useLongPressShare'
import { shareMatchAsImage } from '@/lib/shareMatchAsImage'
```

- [ ] **Step 3: Rename the existing `matchKey` function to `matchKeyFor` and add a `matchByKey` map**

The existing function on line 112 already builds the right shape — rename it to free up `matchKey` (a name we use as a local variable for hover/lock state inside `renderMatch`) and avoid confusion.

Replace the existing `matchKey` function (around lines 112-116):

```ts
  const matchKey = (m: MatchEntry): string => {
    const a = m.team1[0]?.playerId ?? ''
    const b = m.team2[0]?.playerId ?? ''
    return `${m.drawNum}|${m.round}|${a}|${b}`
  }
```

with:

```ts
  const matchKeyFor = (m: MatchEntry): string => {
    const a = m.team1[0]?.playerId ?? ''
    const b = m.team2[0]?.playerId ?? ''
    return `${m.drawNum}|${m.round}|${a}|${b}`
  }

  const matchByKey = useMemo(() => {
    const map = new Map<string, MatchEntry>()
    for (const g of groups) for (const m of g.matches) map.set(matchKeyFor(m), m)
    return map
  }, [groups])
```

Then update the one existing caller in `recordMatchView` (around line 119). Replace:

```ts
    const id = matchKey(m)
```

with:

```ts
    const id = matchKeyFor(m)
```

- [ ] **Step 4: Add the container ref and the delegation hook**

Below the existing state hooks (around line 110, after `const [lockedKey, setLockedKey] = useState<string | null>(null)`), add:

```ts
  const containerRef = useRef<HTMLDivElement>(null)

  useLongPressShare(containerRef, {
    matchSelector: '.ms-match',
    onFire: (el) => {
      const key = el.dataset.matchKey
      if (!key || !tournamentName) return
      const m = matchByKey.get(key)
      if (!m) return
      void shareMatchAsImage({
        matchEl: el,
        tournamentName,
        eventName: m.draw,
      })
      track('match_shared_as_image', {
        tournament_id: tournamentId,
        match_id: key,
        round_name: m.round,
        draw_id: m.drawNum,
      })
    },
  })
```

- [ ] **Step 5: Add `data-match-key` to each rendered row**

In `renderMatch`, find the `.ms-match` div (around line 176). Add the `data-match-key` attribute:

```tsx
    <div
      key={matchKey}
      ref={isTarget ? registerTargetRef : undefined}
      className={matchCls}
      data-match-key={matchKeyFor(m)}
      onMouseEnter={() => setHoveredKey(matchKey)}
      onMouseLeave={() => setHoveredKey(null)}
      onClick={() => setLockedKey((prev: string | null) => prev === matchKey ? null : matchKey)}
    >
```

(The local variable `matchKey` here is the `${gi}-${mi}` string used for hover/lock state — leave it; the new attribute uses the stable `matchKeyFor(m)`.)

- [ ] **Step 6: Attach `containerRef` to the root `.match-schedule` div**

In the `return` block (around line 274), change:

```tsx
    <div className="match-schedule">
```

to:

```tsx
    <div className="match-schedule" ref={containerRef}>
```

- [ ] **Step 7: Run existing component tests**

Run: `npx jest __tests__/MatchSchedule.live.test.tsx __tests__/MatchSchedule.highlight.test.tsx`
Expected: PASS — existing behaviour is unchanged.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 9: Commit**

```bash
git add components/MatchSchedule.tsx
git commit -m "feat(share): wire long-press share via container delegation in MatchSchedule"
```

---

## Task 9: Pass `tournamentName` from page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the prop to all three `<MatchSchedule>` instances**

In `app/page.tsx`, find each of the three `<MatchSchedule ...>` calls (around lines 882, 904, 925). Add `tournamentName={tournamentName}` immediately after `tournamentId={selectedTournament}` in each one:

```tsx
          tournamentId={selectedTournament}
          tournamentName={tournamentName}
        />
```

The `tournamentName` state variable already exists on line 110 of `page.tsx`, so no other changes are needed.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(share): pass tournamentName prop to MatchSchedule for share header"
```

---

## Task 10: Full test suite + manual smoke test

**Files:** none (or follow-up fix commits)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS for all tests (existing + new).

- [ ] **Step 2: Run the dev server**

Run: `npm run dev`

- [ ] **Step 3: Smoke-test in mobile context**

Verify on a touch device or Chrome devtools mobile emulation (use the touch event emulation toggle):

- Long-press (~500ms) on a match row → row scales down → vibrate (device only) → share sheet appears with a JPEG attached.
- The captured JPEG shows: BAT wordmark header, tournament name, event name, timestamp, and the match row underneath.
- The captured JPEG is light-themed even when the app is in dark mode.
- The captured JPEG has no blue (active) / orange (next-opp) / yellow (search-highlight) tint.
- Releasing before 500ms → row snaps back, click-to-lock toggles as before.
- Tapping a player name → opens player profile (long-press did not interfere).
- Tapping the H2H button → opens H2H (long-press did not interfere).
- Scrolling vertically over a match row does not trigger the gesture.
- Desktop: long-press is a no-op; click-to-lock and hover-to-highlight unchanged.
- macOS Safari with `prefers-reduced-motion` on → no scale animation during press.

- [ ] **Step 4: If any manual check fails, fix in a separate commit**

Investigate root cause. Reproduce with a unit test if possible. Ship the fix.

- [ ] **Step 5: Optional — update spec/plan if implementation diverged**

```bash
git add docs/superpowers/
git commit -m "docs(share): update spec/plan to match shipped implementation"
```

---

## Out of scope (per spec)

- Custom share-optimised layout
- Sharing multiple matches at once
- Desktop right-click → share
- Per-language share text
