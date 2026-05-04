'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { CustomTab } from '@/lib/customTab'

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  initial: CustomTab | null
  onClose: () => void
  onSave: (tab: CustomTab) => void
  onDelete?: () => void
}

export default function CustomTabModal({ open, mode, initial, onClose, onSave, onDelete }: Props) {
  const { t } = useLanguage()
  const [nickname, setNickname] = useState('')
  const [keyword, setKeyword] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const nicknameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setNickname(initial?.nickname ?? '')
    setKeyword(initial?.keyword ?? '')
    setConfirmingDelete(false)
    const id = window.setTimeout(() => nicknameRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const trimmedNick = nickname.trim()
  const trimmedKw = keyword.trim()
  const canSave = trimmedNick.length > 0 && trimmedKw.length > 0

  const submit = () => {
    if (!canSave) return
    onSave({ nickname: trimmedNick, keyword: trimmedKw })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const title = mode === 'create' ? t('customTabCreate') : t('customTabEdit')

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>
        <div className="pm-header">
          <div className="pm-section-title">{title}</div>
        </div>

        <div className="pm-section">
          <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1">
            {t('customTabName')}
          </label>
          <input
            ref={nicknameRef}
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full border border-[var(--border)] rounded-md px-2.5 py-1.5 text-sm bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)]"
            maxLength={40}
          />
        </div>

        <div className="pm-section">
          <label className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1">
            {t('customTabKeyword')}
            <span className="relative inline-flex">
              <button
                type="button"
                onMouseEnter={() => setHelpOpen(true)}
                onMouseLeave={() => setHelpOpen(false)}
                onClick={() => setHelpOpen((o) => !o)}
                aria-label={t('searchHelp')}
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[var(--muted)] text-[9px] font-bold text-[var(--muted)] leading-none hover:bg-[var(--border)] hover:text-[var(--fg)] cursor-help"
              >?</button>
              {helpOpen && (
                <div className="absolute left-0 top-full mt-1 z-[60] w-[300px] p-2.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] text-xs leading-relaxed shadow-lg normal-case tracking-normal font-normal">
                  {t('searchHelp')}
                </div>
              )}
            </span>
          </label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="kba & BS U15"
            className="w-full border border-[var(--border)] rounded-md px-2.5 py-1.5 text-sm bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)]"
          />
        </div>

        <div className="pm-section flex items-center justify-between gap-2">
          <div>
            {mode === 'edit' && onDelete && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1.5"
              >{t('customTabDelete')}</button>
            )}
            {mode === 'edit' && onDelete && confirmingDelete && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md px-2.5 py-1.5"
                >{t('customTabDeleteConfirm')}</button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)] px-2 py-1.5"
                >{t('customTabCancel')}</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)] px-3 py-1.5"
            >{t('customTabCancel')}</button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSave}
              className="text-xs font-semibold bg-[var(--brand)] hover:opacity-90 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5"
            >{t('customTabSave')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
