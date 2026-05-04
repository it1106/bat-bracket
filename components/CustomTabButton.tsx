'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { CustomTab } from '@/lib/customTab'

interface Props {
  tab: CustomTab
  active: boolean
  onActivate: () => void
  onEdit: () => void
  onDropTab: (draggedId: string) => void
}

const MAX_VISIBLE = 10

function displayName(nickname: string): string {
  if (nickname.length <= MAX_VISIBLE) return nickname
  return nickname.slice(0, MAX_VISIBLE) + '…'
}

export default function CustomTabButton({ tab, active, onActivate, onEdit, onDropTab }: Props) {
  const { t } = useLanguage()
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  return (
    <button
      onClick={onActivate}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', tab.id)
        e.dataTransfer.effectAllowed = 'move'
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDragEnter={() => setDragOver(true)}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const draggedId = e.dataTransfer.getData('text/plain')
        if (draggedId && draggedId !== tab.id) onDropTab(draggedId)
      }}
      title={tab.nickname}
      className={`group inline-flex items-center gap-1 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-grab ${
        active
          ? 'border-[var(--brand)] text-[var(--brand-fg)]'
          : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
      } ${dragging ? 'opacity-60' : ''} ${dragOver ? 'bg-[var(--border)]' : ''}`}
    >
      <span>{displayName(tab.nickname)}</span>
      <span
        role="button"
        tabIndex={0}
        draggable={false}
        aria-label={t('customTabEdit')}
        title={t('customTabEdit')}
        onClick={(e) => {
          e.stopPropagation()
          onEdit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            e.preventDefault()
            onEdit()
          }
        }}
        onDragStart={(e) => { e.preventDefault(); e.stopPropagation() }}
        className="inline-flex items-center justify-center w-4 h-4 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] text-[11px] leading-none cursor-pointer"
      >✎</span>
    </button>
  )
}
