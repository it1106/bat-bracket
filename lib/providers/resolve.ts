import type { TournamentRef } from '@/lib/types'
import type { TournamentProvider } from './types'
import { batProvider } from './bat-provider'
import { bwfProvider } from './bwf-provider'

export function providerFor(ref: TournamentRef): TournamentProvider {
  return ref.provider === 'bwf' ? bwfProvider : batProvider
}
