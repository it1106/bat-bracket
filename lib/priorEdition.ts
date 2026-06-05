export interface PriorEditionWinnerEntry {
  players: string[]
  club?: string
  priorEditionId: string
  priorEditionLabel: string
}
export type PriorEditionWinnerMap = Map<string, PriorEditionWinnerEntry>
