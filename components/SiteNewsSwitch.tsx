'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'

/** One switch for everything newly published on the site: a tournament, its
 *  draws, its schedule. Unlike a follow it names no tournament, so it is the
 *  panel's own row rather than part of the Following list. Renders nothing
 *  where push cannot work, as FollowingList does. */
export default function SiteNewsSwitch() {
  const { t } = useLanguage()
  const push = usePushFollows()
  const [problem, setProblem] = useState<'denied' | 'error' | null>(null)
  if (push.status !== 'ok') return null

  const toggle = async () => {
    const on = !push.siteNews
    const outcome = await push.setSiteNews(on)
    if (outcome === 'ok') {
      setProblem(null)
      track('site_news_toggled', { on })
      return
    }
    setProblem(outcome === 'denied' ? 'denied' : 'error')
  }

  return (
    <div className="following">
      <label className="following-row" style={{ cursor: 'pointer' }}>
        <span>
          <span>{t('siteNewsTitle')}</span>
          <span className="following-where"> · {t('siteNewsNote')}</span>
        </span>
        <input
          type="checkbox"
          checked={push.siteNews}
          onChange={() => void toggle()}
          aria-label={t('siteNewsTitle')}
        />
      </label>
      {problem && <div className="following-where">{t('followBlocked')}</div>}
    </div>
  )
}
