import CountryMatrixFullView from '@/components/CountryMatrixFullView'

interface Props {
  params: { tournamentId: string }
  searchParams: { name?: string }
}

// Standalone full-page view of a tournament's country head-to-head matrix.
// Linked from the stats panel (opens in a new tab); the tournament name rides
// along as ?name= so we don't need a second lookup just for the header.
export default function CountryMatrixPage({ params, searchParams }: Props) {
  return (
    <CountryMatrixFullView
      tournamentId={params.tournamentId}
      tournamentName={searchParams.name}
    />
  )
}

export const dynamic = 'force-dynamic'
