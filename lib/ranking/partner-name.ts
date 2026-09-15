/** Partner names reach us from two independent sources: BAT's ranking detail
 *  rows (`doublesPartner`) and our own index (`PlayerEventResult.partnerName`,
 *  read off the bracket). They agree on spelling but not always on decoration —
 *  brackets carry a seed marker ("รวิณ ชูชัยศรี [4]") and either side can pick
 *  up doubled or non-breaking spaces. Normalise both through here before
 *  comparing; matching raw strings silently drops a seeded pairing's rows and
 *  understates it by a whole tournament.
 *
 *  Verified against the live caches: normalised this way, all 119 U15
 *  MD/WD/MXD pairings whose lead player has a cached detail reproduce BAT's
 *  official pairing points exactly. */
export function normalizePartnerName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .replace(/\[[^\]]*\]/g, ' ')   // seed marker, wherever it sits
    .replace(/\s+/g, ' ')          // incl. NBSP and doubled spaces
    .trim()
    .toLowerCase()                 // no-op for Thai, tolerant for latin entries
}

/** True when two partner names denote the same person. An empty name on either
 *  side never matches: "unknown partner" is not "same partner". */
export function samePartner(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePartnerName(a)
  return na !== '' && na === normalizePartnerName(b)
}
