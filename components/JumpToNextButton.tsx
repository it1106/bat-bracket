'use client'

import { useLanguage } from '@/lib/LanguageContext'
import { useScrollActivity } from '@/lib/useScrollActivity'

interface Props {
  visible: boolean
  onClick: () => void
}

export default function JumpToNextButton({ visible, onClick }: Props) {
  const { t } = useLanguage()
  const active = useScrollActivity()
  if (!visible) return null
  const label = t('jumpToNext')
  return (
    <button
      type="button"
      className={`ms-jump-next${active ? '' : ' ms-jump-next--hidden'}`}
      aria-label={label}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
