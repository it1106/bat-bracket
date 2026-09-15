'use client'
import { useLanguage } from '@/lib/LanguageContext'
import { classifyExpiry, type ExpiryCutoffs, type RankingSection } from '@/lib/ranking/player-view'
import { entryForPairing } from '@/lib/ranking/pair-lookup'
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

/** This section's own rank. A section is one PAIRING, and each pairing is a
 *  separate ranking entry, so the lookup is by player AND partner — matching
 *  on the player alone would pin whichever pairing happens to be listed first
 *  on all of them. Null when no entry matches (a pairing below the cached
 *  depth, or one the two sources spell differently), which just hides the
 *  badge. */
function lookupRank(
  current: Ranking | null | undefined,
  section: RankingSection,
  slug: string,
): number | null {
  if (!current) return null
  const ev = current.events.find((e) => e.eventName === section.eventName)
  if (!ev) return null
  return entryForPairing(ev, { slug }, section.doublesPartner)?.rank ?? null
}

export default function RankingEventSection({ slug, section, cutoffs, currentRanking }: Props) {
  const { t } = useLanguage()
  // Every pairing carries its own rank now that the lookup can tell them
  // apart, so `section.rankAmbiguous` no longer gates this.
  const myRank = lookupRank(currentRanking, section, slug)
  const totalDisplay = Math.round(section.topTotal).toLocaleString()
  return (
    <section className="pp-rd-section-event">
      <h3 className="pp-rd-section-event-header">
        <span>
          {section.eventName}
          {section.doublesPartner && (
            <span className="pp-rd-section-event-partner"> / {section.doublesPartner}</span>
          )}
        </span>
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
