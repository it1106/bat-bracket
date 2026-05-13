import { request } from './cf-context'

export interface TournamentDetailParams { tmtId: number }
export interface TournamentDrawsParams { tmtId: number; tmtType?: number; tmtTab?: string }
export interface TournamentDrawDataParams { tmtId: number; drawId: string; tmtType?: number; tmtTab?: string; isPara?: boolean }
export interface DayMatchesParams { tournamentCode: string; date: string; order?: 1 | 2; court?: number }

export async function fetchTournamentDetail(p: TournamentDetailParams): Promise<unknown> {
  return request('POST', '/api/vue-tournament-detail', { tmtId: p.tmtId })
}

export async function fetchTournamentDraws(p: TournamentDrawsParams): Promise<unknown> {
  return request('POST', '/api/vue-tournament-draws', {
    tmtId: p.tmtId,
    tmtType: p.tmtType ?? 0,
    tmtTab: p.tmtTab ?? 'draw',
  })
}

export async function fetchTournamentDrawData(p: TournamentDrawDataParams): Promise<unknown> {
  return request('POST', '/api/vue-tournament-draw-data', {
    tmtId: p.tmtId,
    tmtType: p.tmtType ?? 0,
    tmtTab: p.tmtTab ?? 'draw',
    drawId: p.drawId,
    isPara: p.isPara ?? false,
  })
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
