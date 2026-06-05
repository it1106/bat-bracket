'use client'
import { useLanguage } from '@/lib/LanguageContext'
import { classifyExpiry, type ExpiryCutoffs, type RankingSection } from '@/lib/ranking/player-view'
import type { Ranking } from '@/lib/types'
import TournamentRow from './TournamentRow'

interface Props {
  /** Player slug — used to look up the player's rank in this event for the
   *  section header. */
  slug: string
  section: RankingSection
  cutoffs: ExpiryCutoffs
  currentRanking?: Ranking | null
}

function lookupRank(current: Ranking | null | undefined, eventName: string, slug: string): number | null {
  if (!current) return null
  const ev = current.events.find((e) => e.eventName === eventName)
  return ev?.entries.find((e) => e.slug === slug)?.rank ?? null
}

export default function BwfRankingSection({ slug, section, cutoffs, currentRanking }: Props) {
  const { t } = useLanguage()
  const myRank = lookupRank(currentRanking, section.eventName, slug)
  const totalDisplay = Math.round(section.topTotal).toLocaleString()
  return (
    <section className="pp-rd-section-event">
      <h3 className="pp-rd-section-event-header">
        <span>{section.eventName}</span>
        <span className="pp-rd-section-event-meta">
          {myRank !== null && <>#{myRank} · </>}
          {totalDisplay} pts
        </span>
      </h3>

      <h4 className="pp-rd-section-subheader">{t('rankingDetailTopTen')}</h4>
      {section.top.map((sr, i) => (
        <TournamentRow
          key={`t-${i}-${sr.row.week}-${sr.row.tournamentName}`}
          row={sr.row}
          creditOverride={sr.creditInThisSection}
          expiry={classifyExpiry(sr.row.week, cutoffs)}
        />
      ))}

      {section.others.length > 0 && (
        <>
          <h4 className="pp-rd-section-subheader pp-rd-section-subheader--divided">
            {t('rankingDetailOthersTournaments')}
          </h4>
          {section.others.map((sr, i) => (
            <TournamentRow
              key={`o-${i}-${sr.row.week}-${sr.row.tournamentName}`}
              row={sr.row}
              creditOverride={sr.creditInThisSection}
              expiry={classifyExpiry(sr.row.week, cutoffs)}
            />
          ))}
        </>
      )}
    </section>
  )
}
