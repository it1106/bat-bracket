'use client'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import {
  buildSuggestions,
  currentTerm,
  replaceTerm,
  type Suggestion,
} from '@/lib/searchSuggestions'

interface Props {
  value: string
  onChange: (next: string) => void
  /** Players and event types present in what the current view has loaded, so
   *  every suggestion the reader picks is one that actually has matches. */
  candidates: readonly Suggestion[]
}

/** The search box with a partial-match list under it. Completion applies to
 *  the segment being typed, so an existing "BS U15 & " prefix survives. */
const PlayerSearchBox = forwardRef<HTMLInputElement, Props>(function PlayerSearchBox(
  { value, onChange, candidates },
  ref,
) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)

  const term = currentTerm(value).text
  const hits = useMemo(() => buildSuggestions(candidates, term), [candidates, term])
  const visible = open && hits.length > 0

  // A fresh term starts with nothing highlighted, so a plain Enter keeps
  // behaving as it did before the list existed.
  useEffect(() => { setActive(-1) }, [term])

  useEffect(() => {
    if (!visible) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [visible])

  const accept = (hit: Suggestion) => {
    onChange(replaceTerm(value, hit.value))
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (visible) { e.stopPropagation(); setOpen(false) }
      return
    }
    if (!visible) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      accept(hits[active])
    }
  }

  return (
    <div ref={wrapRef} className="relative min-w-[150px] shrink-0">
      <input
        ref={ref}
        type="text"
        placeholder={t('searchPlaceholder')}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={visible}
        aria-controls="player-search-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `player-search-suggestion-${active}` : undefined}
        className="w-full border border-[var(--border)] rounded-md pl-2.5 pr-7 py-1.5 text-xs bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)]"
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); setOpen(false) }}
          aria-label={t('clearSearch')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] text-[length:calc(11px*var(--text-scale))] leading-none"
        >✕</button>
      )}
      {visible && (
        <ul
          id="player-search-suggestions"
          role="listbox"
          aria-label={t('searchSuggestions')}
          className="absolute left-0 top-full mt-1 z-[60] w-[min(320px,calc(100vw-24px))] max-h-[min(320px,60vh)] overflow-y-auto py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        >
          {hits.map((hit, i) => (
            <li
              key={`${hit.kind}:${hit.value}`}
              id={`player-search-suggestion-${i}`}
              role="option"
              aria-selected={i === active}
              // The input keeps focus: mousedown would blur it before the click.
              onMouseDown={(e) => { e.preventDefault(); accept(hit) }}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs cursor-pointer text-[var(--fg)] ${
                i === active ? 'bg-[var(--border)]' : ''
              }`}
            >
              <span className="truncate">{hit.value}</span>
              {hit.kind === 'event' && (
                <span className="shrink-0 text-[length:calc(9px*var(--text-scale))] uppercase tracking-wide text-[var(--muted)]">
                  {t('eventType')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

export default PlayerSearchBox
