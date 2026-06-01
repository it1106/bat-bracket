'use client'

import { useLanguage } from '@/lib/LanguageContext'
import type { CustomTab } from '@/lib/customTab'

interface Props {
  tab: CustomTab
  active: boolean
  editMode: boolean
  onActivate: () => void
  onEdit: () => void
}

const MAX_VISIBLE = 10

function displayName(nickname: string): string {
  if (nickname.length <= MAX_VISIBLE) return nickname
  return nickname.slice(0, MAX_VISIBLE) + '…'
}

export default function CustomTabButton({ tab, active, editMode, onActivate, onEdit }: Props) {
  const { t } = useLanguage()

  return (
    <button
      onClick={editMode ? onEdit : onActivate}
      data-custom-tab-id={tab.id}
      title={editMode ? t('customTabEdit') : tab.nickname}
      className={`custom-tab-button inline-flex items-center px-[5px] sm:px-4 py-[3px] sm:py-2.5 text-xs font-semibold border-b-2 transition-colors ${
        editMode ? 'cursor-grab' : 'cursor-pointer'
      } ${
        active
          ? 'border-[var(--brand)] text-[var(--brand-fg)]'
          : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
      } ${editMode ? 'custom-tab-button--edit-mode' : ''}`}
    >
      <span>{displayName(tab.nickname)}</span>
    </button>
  )
}
