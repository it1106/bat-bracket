import { playerClubCache } from '@/lib/bracket-cache'
import { readClubsCache } from '@/lib/clubs-cache'
import { normalizeClub } from './alerts'

export interface ClubLookup {
  /** The club BAT lists a player under in this tournament, when known. */
  clubOf: (playerId: string) => string | undefined
  /** Whether any player in this tournament is listed under this club. */
  hasClub: (name: string) => boolean
}

/** Club membership for one tournament, from what the app already holds: the
 *  in-memory map the bracket and roster walks fill (fresher), over the copy
 *  the index rebuild writes to disk. Never asks BAT. */
export async function clubLookup(tournamentId: string): Promise<ClubLookup> {
  const prefix = `${tournamentId.toLowerCase()}:`
  const disk = (await readClubsCache(tournamentId).catch(() => null)) ?? {}
  const clubOf = (playerId: string) => playerClubCache.get(`${prefix}${playerId}`) ?? disk[playerId]
  const hasClub = (name: string) => {
    const want = normalizeClub(name)
    if (!want) return false
    for (const club of Object.values(disk)) if (normalizeClub(club) === want) return true
    for (const [key, club] of Array.from(playerClubCache)) {
      if (key.startsWith(prefix) && normalizeClub(club) === want) return true
    }
    return false
  }
  return { clubOf, hasClub }
}
