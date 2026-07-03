import { request } from './cf-context'

export interface TournamentDetailParams { tmtId: number }
export interface TournamentDrawsParams { tmtId: number; tmtType?: number; tmtTab?: string }
export interface TournamentDrawDataParams { tmtId: number; drawId: string; tmtType?: number; tmtTab?: string; isPara?: boolean }
export interface DayMatchesParams { tournamentCode: string; date: string; order?: 1 | 2; court?: number }

// BWF migrated the vue-tournament-* endpoints from POST-with-JSON-body to
// GET-with-query-string (a POST now returns 405 Method Not Allowed). The
// response envelope is unchanged ({ results: ... }), so only the transport
// moves here; the parsers stay as-is. Keep params in the query string.
export async function fetchTournamentDetail(p: TournamentDetailParams): Promise<unknown> {
  const qs = new URLSearchParams({ tmtId: String(p.tmtId) })
  return request('GET', `/api/vue-tournament-detail?${qs}`)
}

export async function fetchTournamentDraws(p: TournamentDrawsParams): Promise<unknown> {
  const qs = new URLSearchParams({
    tmtId: String(p.tmtId),
    tmtType: String(p.tmtType ?? 0),
    tmtTab: p.tmtTab ?? 'draw',
  })
  return request('GET', `/api/vue-tournament-draws?${qs}`)
}

export async function fetchTournamentDrawData(p: TournamentDrawDataParams): Promise<unknown> {
  const qs = new URLSearchParams({
    tmtId: String(p.tmtId),
    tmtType: String(p.tmtType ?? 0),
    tmtTab: p.tmtTab ?? 'draw',
    drawId: p.drawId,
    isPara: String(p.isPara ?? false),
  })
  return request('GET', `/api/vue-tournament-draw-data?${qs}`)
}

export async function fetchDayMatches(p: DayMatchesParams): Promise<unknown> {
  const params = new URLSearchParams({
    tournamentCode: p.tournamentCode,
    date: p.date,
    order: String(p.order ?? 2),
    court: String(p.court ?? 0),
  })
  return request('GET', `/api/tournaments/day-matches?${params}`)
}
